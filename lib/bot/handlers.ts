import { Actions, Button, Card, CardText, LinkButton } from 'chat';
import type { Adapter, Chat, Thread } from 'chat';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages as messagesTable, orderItems, orders, products, users } from '@/lib/db/schema';
import { notifyOrderStatusChanged } from './notifications';
import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';
import { releaseAddress } from '@/lib/tron/pool';
import { invalidateProductsCache } from '@/lib/products-cache';
import { restoreStock } from '@/lib/restore-stock';
import { redis } from '@/lib/redis';

// ── Pending-reply state (Redis-backed, keyed by adminId) ─────────────────────
// We don't use Chat SDK thread state for this because (a) setState({}) is a
// no-op merge so state never clears, and (b) it has been unreliable across
// cold starts. Redis directly is simpler and trivially debuggable.
const PENDING_REPLY_TTL_S = 60 * 60; // 1 hour
const pendingReplyKey = (adminId: number) => `pending_reply:${adminId}`;
type PendingReply = { userId: number; userLabel: string };

async function setPendingReply(adminId: number, target: PendingReply): Promise<void> {
  await redis.set(pendingReplyKey(adminId), target, { ex: PENDING_REPLY_TTL_S });
}
async function getPendingReply(adminId: number): Promise<PendingReply | null> {
  const raw = await redis.get<PendingReply | string>(pendingReplyKey(adminId));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as PendingReply; } catch { return null; }
  }
  return raw;
}
async function clearPendingReply(adminId: number): Promise<void> {
  await redis.del(pendingReplyKey(adminId));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const STATUS_EMOJI: Record<string, string> = {
  pending: '🕐',
  awaiting_payment: '💳',
  paid: '✅',
  processing: '⚙️',
  shipped: '🚚',
  delivered: '📦',
  cancelled: '❌',
};

const VALID_STATUSES = Object.keys(STATUS_EMOJI);

interface ThreadState {
  pendingUserId?: number;
  pendingUserLabel?: string;
}

// Uses raw Telegram API so we can send web_app buttons (Chat SDK doesn't expose them)
async function sendUserWelcome(userId: number): Promise<void> {
  await tgSend(
    userId,
    'Добро пожаловать в наш магазин! 🛒\n\nПросматривайте каталог и оплачивайте заказы через USDT.',
    {
      inline_keyboard: [
        [{ text: '🛍️ Открыть каталог', web_app: { url: MINI_APP_URL } }],
        [
          { text: '📋 Мои заказы', callback_data: 'my_orders' },
          { text: '💬 Написать менеджеру', callback_data: 'contact_manager' },
        ],
        [{ text: '💡 Предложить товар', callback_data: 'suggest_product' }],
      ],
    },
  );
}

async function sendAdminPanel(userId: number): Promise<void> {
  await tgSend(
    userId,
    '👑 <b>Панель администратора</b>\n\nОтвечайте на сообщения пользователей — ответ придёт анонимно от имени бота.\n\n<i>Нажмите кнопку «Ответить» рядом с пересланным сообщением.</i>',
    {
      inline_keyboard: [
        [{ text: '💬 Диалоги с пользователями', callback_data: 'admin_dialogs' }],
        [{ text: '📦 Последние заказы', callback_data: 'admin_orders' }],
      ],
    },
  );
}

async function upsertUser(
  authorId: number,
  userName: string,
  fullName: string,
): Promise<void> {
  const firstName = fullName.split(' ')[0] ?? 'User';
  const username = userName || undefined;
  await db
    .insert(users)
    .values({ telegramId: authorId, username, firstName })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { firstName, username },
    });
}

async function relayToAdmins(
  _bot: Chat<Record<string, Adapter>, ThreadState>,
  userId: number,
  userLabel: string,
  text: string,
): Promise<void> {
  // Use raw Telegram API instead of Chat SDK openDM().post() —
  // openDM is unreliable across cold starts in serverless.
  const results = await Promise.allSettled(
    ADMIN_IDS.map((adminId) =>
      tgSend(
        adminId,
        `📨 <b>Сообщение от ${escapeHtml(userLabel)}</b>\n\n${escapeHtml(text)}`,
        {
          inline_keyboard: [
            [{ text: '💬 Ответить', callback_data: `reply_to:${userId}` }],
          ],
        },
      ),
    ),
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('[relay] Could not reach admin:', r.reason);
    }
  }
}

async function handleStatus(
  thread: Thread<ThreadState>,
  msgText: string,
  authorId: number,
): Promise<void> {
  const orderId = parseInt(msgText.replace('/status', '').trim(), 10);
  if (isNaN(orderId)) {
    await thread.post('Использование: /status <номер_заказа>');
    return;
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== authorId) {
    await thread.post('Заказ не найден.');
    return;
  }

  const emoji = STATUS_EMOJI[order.status] ?? '❓';
  await thread.post({
    markdown:
      `**Заказ #${order.id}**\n` +
      `Статус: ${emoji} ${order.status.replaceAll('_', ' ')}\n` +
      `Сумма: $${order.totalUsdt} USDT` +
      (order.txHash ? `\nTX: \`${order.txHash}\`` : ''),
  });
}

async function handleOrders(userId: number): Promise<void> {
  const userOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(5);

  if (!userOrders.length) {
    await tgSend(userId, '📭 У вас пока нет заказов.', {
      inline_keyboard: [
        [{ text: '🛍️ Открыть каталог', web_app: { url: MINI_APP_URL } }],
      ],
    });
    return;
  }

  const lines = userOrders.map(
    (o) => `${STATUS_EMOJI[o.status] ?? '❓'} <b>#${o.id}</b> — ${o.status.replaceAll('_', ' ')} — $${o.totalUsdt} USDT`,
  );
  await tgSend(
    userId,
    `📦 <b>Ваши последние заказы:</b>\n\n${lines.join('\n')}\n\nИспользуйте /status &lt;номер&gt; для деталей.`,
    {
      inline_keyboard: [
        [{ text: '📋 Все заказы', web_app: { url: `${MINI_APP_URL}/orders` } }],
      ],
    },
  );
}

async function handleHelp(userId: number, isAdmin: boolean): Promise<void> {
  const userHelp =
    `ℹ️ <b>Как пользоваться магазином:</b>\n\n` +
    `🛍️ Нажмите <b>Меню</b> внизу чата → откроется каталог\n` +
    `🛒 Добавьте товары в корзину → оформите заказ\n` +
    `💳 Оплатите USDT (TRC20) или TON\n` +
    `⏳ Бот уведомит вас, когда оплата подтверждена\n\n` +
    `<b>Команды:</b>\n` +
    `/start — Главное меню\n` +
    `/orders — Мои заказы\n` +
    `/status &lt;номер&gt; — Статус заказа\n` +
    `/help — Помощь\n\n` +
    `💬 Для связи с менеджером — просто напишите сообщение.`;

  const adminHelp =
    `👑 <b>Панель администратора:</b>\n\n` +
    `💬 <b>Диалоги</b> — просмотр сообщений от пользователей\n` +
    `📦 <b>Заказы</b> — управление статусами\n\n` +
    `Для ответа пользователю нажмите <b>«Ответить»</b> рядом с его сообщением.\n\n` +
    `/start — Панель администратора\n` +
    `/orders — Все заказы\n` +
    `/status &lt;номер&gt; — Детали заказа`;

  await tgSend(userId, isAdmin ? adminHelp : userHelp, {
    inline_keyboard: [
      [{ text: '🛍️ Открыть каталог', web_app: { url: MINI_APP_URL } }],
    ],
  });
}

/**
 * Shared command dispatcher — handles /start, /status, /orders, /help.
 * Returns true if a command was matched, false if the message should fall through.
 */
async function dispatchCommand(
  _bot: Chat<Record<string, Adapter>, ThreadState>,
  thread: Thread<ThreadState>,
  message: { text?: string; author: { userId: string; userName: string; fullName: string } },
): Promise<boolean> {
  const authorId = parseInt(message.author.userId, 10);
  const isAdmin = ADMIN_IDS.includes(authorId);
  const msgText = message.text ?? '';

  if (msgText.startsWith('/start')) {
    if (isAdmin) {
      await sendAdminPanel(authorId);
    } else {
      await upsertUser(authorId, message.author.userName, message.author.fullName);
      await sendUserWelcome(authorId);
    }
    return true;
  }

  if (msgText.startsWith('/status')) {
    await handleStatus(thread, msgText, authorId);
    return true;
  }

  if (msgText.startsWith('/orders')) {
    await handleOrders(authorId);
    return true;
  }

  if (msgText.startsWith('/help')) {
    await handleHelp(authorId, isAdmin);
    return true;
  }

  return false;
}

/** Cancel an order: restore stock, release TRC20 address, invalidate cache.
 *  Guards against double-cancel and cancelling delivered orders. */
async function cancelOrder(orderId: number, adminChatId: number): Promise<void> {
  const [updated] = await db
    .update(orders)
    .set({ status: 'cancelled' })
    .where(and(
      eq(orders.id, orderId),
      // Prevent double-cancel (would restore stock twice) and cancelling delivered orders
      sql`${orders.status} NOT IN ('cancelled', 'delivered')`,
    ))
    .returning();

  if (!updated) {
    await tgSend(adminChatId, '❌ Заказ не найден.');
    return;
  }

  // Use shared restoreStock util — aggregates by product and handles errors with logging
  await restoreStock([orderId], 'bot-cancel');

  if (updated.paymentMethod === 'trc20' && updated.paymentAddress) {
    await releaseAddress(updated.paymentAddress).catch((err) =>
      console.error(`[cancelOrder] Failed to release address for order ${orderId}:`, err)
    );
  }
  await invalidateProductsCache().catch(() => {});

  await tgSend(adminChatId, `✅ Статус заказа #${orderId} обновлён: ❌ <b>cancelled</b>`);

  if (updated.userId) {
    await notifyOrderStatusChanged(updated.userId, orderId, 'cancelled');
  }
}

export function registerBotHandlers(bot: Chat<Record<string, Adapter>, ThreadState>): void {
  // ── New DM (first contact, thread not yet subscribed) ─────────────────────
  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();

    // First-contact with no text (e.g. bot opened without sending a message)
    if (!message.text) {
      const authorId = parseInt(message.author.userId, 10);
      if (ADMIN_IDS.includes(authorId)) {
        await sendAdminPanel(authorId);
      } else {
        await upsertUser(authorId, message.author.userName, message.author.fullName);
        await sendUserWelcome(authorId);
      }
      return;
    }

    if (await dispatchCommand(bot, thread, message)) return;

    const authorId = parseInt(message.author.userId, 10);
    const isAdmin = ADMIN_IDS.includes(authorId);
    const msgText = message.text ?? '';

    if (isAdmin) {
      await sendAdminPanel(authorId);
    } else {
      await upsertUser(authorId, message.author.userName, message.author.fullName);
      await relayToAdmins(bot, authorId, message.author.fullName, msgText);
      await thread.post('✅ Ваше сообщение отправлено менеджеру. Ожидайте ответа.');
      await db
        .insert(messagesTable)
        .values({ userId: authorId, direction: 'user_to_admin', content: msgText })
        .catch((err) => console.error('[relay] DB insert failed:', err));
    }
  });

  // ── Subscribed thread messages ─────────────────────────────────────────────
  bot.onSubscribedMessage(async (thread, message) => {
    if (await dispatchCommand(bot, thread, message)) return;

    const authorId = parseInt(message.author.userId, 10);
    const isAdmin = ADMIN_IDS.includes(authorId);
    const msgText = message.text ?? '';

    if (isAdmin) {
      if (msgText === '/cancel') {
        await clearPendingReply(authorId);
        await thread.post('❌ Ответ отменён.');
        return;
      }

      const pending = await getPendingReply(authorId);
      console.log(`[relay] admin ${authorId} message; pending=`, pending);
      if (pending?.userId) {
        const { userId: pendingUserId, userLabel: pendingUserLabel } = pending;
        await clearPendingReply(authorId);
        try {
          await tgSend(
            pendingUserId,
            `💬 <b>Ответ менеджера:</b>\n\n${escapeHtml(msgText)}`,
          );
          await thread.post(`✅ Ответ отправлен — ${pendingUserLabel}.`);
          await db
            .insert(messagesTable)
            .values({ userId: pendingUserId, direction: 'admin_to_user', content: msgText })
            .catch((err) => console.error('[relay] DB insert failed:', err));

          // Notify other admins that a reply was sent
          const otherAdmins = ADMIN_IDS.filter((id) => id !== authorId);
          if (otherAdmins.length > 0) {
            const adminLabel = message.author.userName
              ? `@${escapeHtml(message.author.userName)}`
              : escapeHtml(message.author.fullName);
            await Promise.allSettled(
              otherAdmins.map((adminId) =>
                tgSend(
                  adminId,
                  `📤 <b>${adminLabel}</b> ответил(а) пользователю <b>${escapeHtml(pendingUserLabel ?? '')}</b>:\n\n<i>${escapeHtml(msgText.slice(0, 200))}</i>`,
                ),
              ),
            );
          }
        } catch (err) {
          console.error('[relay] Failed to deliver admin reply:', err);
          await thread.post(
            `❌ Не удалось доставить сообщение пользователю #${pendingUserId}.\n\n<i>${escapeHtml(String(err))}</i>`,
          );
        }
        return;
      }

      // No pending reply target — show admin panel so admin knows how to proceed
      await sendAdminPanel(authorId);
      return;
    }

    // Regular user message relay
    await relayToAdmins(bot, authorId, message.author.fullName, msgText);
    await thread.post('✅ Ваше сообщение отправлено менеджеру.');
    await db
      .insert(messagesTable)
      .values({ userId: authorId, direction: 'user_to_admin', content: msgText })
      .catch((err) => console.error('[relay] DB insert failed:', err));
  });

  // ── Actions (inline keyboard callbacks) ───────────────────────────────────
  bot.onAction(async (event) => {
    const { actionId, user, thread } = event;
    const authorId = parseInt(user.userId, 10);

    // User: My Orders
    if (actionId === 'my_orders') {
      const userOrders = await db
        .select()
        .from(orders)
        .where(eq(orders.userId, authorId))
        .orderBy(desc(orders.createdAt))
        .limit(5);

      if (!userOrders.length) {
        await thread?.post('У вас пока нет заказов.');
        return;
      }
      const lines = userOrders.map(
        (o) =>
          `• Заказ #${o.id} — ${STATUS_EMOJI[o.status] ?? ''} ${o.status} — $${o.totalUsdt} USDT`,
      );
      await thread?.post({
        markdown:
          `**Последние ${userOrders.length} заказов:**\n\n${lines.join('\n')}\n\n` +
          `Используйте /status <id> для подробностей.`,
      });
      return;
    }

    // User: Contact Manager
    if (actionId === 'contact_manager') {
      await thread?.post(
        '💬 Просто напишите сообщение, и менеджер ответит вам в ближайшее время.\n\nВаши данные остаются конфиденциальными.',
      );
      return;
    }

    // User: Suggest Product — opens mini app via URL button (web_app not available via Chat SDK)
    if (actionId === 'suggest_product') {
      await thread?.post(
        Card({
          children: [
            Actions([LinkButton({ url: `${MINI_APP_URL}/suggest`, label: '💡 Открыть форму предложения' })]),
          ],
        }),
      );
      return;
    }

    // Admin: Recent dialogs (with message counts and timestamps)
    if (actionId === 'admin_dialogs') {
      if (!ADMIN_IDS.includes(authorId)) return;

      const recent = await db
        .select({
          userId: messagesTable.userId,
          content: messagesTable.content,
          createdAt: messagesTable.createdAt,
          username: users.username,
          firstName: users.firstName,
        })
        .from(messagesTable)
        .leftJoin(users, eq(messagesTable.userId, users.telegramId))
        .where(eq(messagesTable.direction, 'user_to_admin'))
        .orderBy(desc(messagesTable.createdAt))
        .limit(30);

      if (!recent.length) {
        await tgSend(authorId, '📭 Сообщений от пользователей пока нет.', {
          inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'admin_panel' }]],
        });
        return;
      }

      // One entry per user (most recent message)
      const seen = new Set<number>();
      const unique: typeof recent = [];
      for (const m of recent) {
        if (!m.userId || seen.has(m.userId)) continue;
        seen.add(m.userId);
        unique.push(m);
      }

      // Get per-user total message counts
      const userIds = unique.map((m) => m.userId!);
      const msgCounts = await db
        .select({
          userId: messagesTable.userId,
          total: sql<number>`count(*)::int`,
        })
        .from(messagesTable)
        .where(inArray(messagesTable.userId, userIds))
        .groupBy(messagesTable.userId);
      const countMap = new Map(msgCounts.map((c) => [c.userId, c.total]));

      const lines = unique.map((m) => {
        const label = m.username ? `@${escapeHtml(m.username)}` : (m.firstName ? escapeHtml(m.firstName) : `#${m.userId}`);
        const preview = m.content.slice(0, 40) + (m.content.length > 40 ? '…' : '');
        const count = countMap.get(m.userId!) ?? 0;
        const time = m.createdAt
          ? m.createdAt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—';
        return `• <b>${label}</b> (${count} сообщ., ${time}):\n  <i>${escapeHtml(preview)}</i>`;
      });

      await tgSend(
        authorId,
        `💬 <b>Последние диалоги:</b>\n\n${lines.join('\n\n')}`,
        {
          inline_keyboard: [
            ...unique.map((m) => {
              const label = m.username ? `@${m.username}` : (m.firstName ?? `#${m.userId}`);
              return [{ text: `💬 Ответить ${label}`, callback_data: `reply_to:${m.userId}` }];
            }),
            [{ text: '◀️ Панель', callback_data: 'admin_panel' }],
          ],
        },
      );
      return;
    }

    // Admin: back to panel
    if (actionId === 'admin_panel') {
      if (!ADMIN_IDS.includes(authorId)) return;
      await sendAdminPanel(authorId);
      return;
    }

    // Admin: Orders — show filter menu
    if (actionId === 'admin_orders') {
      if (!ADMIN_IDS.includes(authorId)) return;
      await tgSend(
        authorId,
        '📦 <b>Заказы — выберите фильтр:</b>',
        {
          inline_keyboard: [
            [
              { text: '🕐 Ожидают', callback_data: 'admin_orders_f:pending' },
              { text: '💳 К оплате', callback_data: 'admin_orders_f:awaiting_payment' },
            ],
            [
              { text: '✅ Оплачены', callback_data: 'admin_orders_f:paid' },
              { text: '⚙️ В обработке', callback_data: 'admin_orders_f:processing' },
            ],
            [
              { text: '🚚 Отправлены', callback_data: 'admin_orders_f:shipped' },
              { text: '📦 Все', callback_data: 'admin_orders_f:all' },
            ],
          ],
        },
      );
      return;
    }

    // Admin: Filtered orders list
    if (actionId.startsWith('admin_orders_f:')) {
      if (!ADMIN_IDS.includes(authorId)) return;
      const filter = actionId.slice('admin_orders_f:'.length);

      const recent = filter === 'all'
        ? await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(15)
        : await db.select().from(orders).where(eq(orders.status, filter)).orderBy(desc(orders.createdAt)).limit(15);

      if (!recent.length) {
        await tgSend(authorId, '📭 Заказов с таким статусом нет.', {
          inline_keyboard: [[{ text: '◀️ Назад к фильтрам', callback_data: 'admin_orders' }]],
        });
        return;
      }

      const statusLabel = filter === 'all' ? 'все' : filter;
      const lines = recent.map(
        (o) => `• #${o.id} — ${STATUS_EMOJI[o.status] ?? '❓'} ${o.status} — $${o.totalUsdt} USDT — User #${o.userId}`,
      );

      await tgSend(
        authorId,
        `📦 <b>Заказы (${escapeHtml(statusLabel)}):</b>\n\n${lines.join('\n')}`,
        {
          inline_keyboard: [
            ...recent.slice(0, 8).map((o) => [{ text: `📝 #${o.id}`, callback_data: `admin_order_${o.id}` }]),
            [{ text: '◀️ Назад к фильтрам', callback_data: 'admin_orders' }],
          ],
        },
      );
      return;
    }

    // Admin: Set pending reply target (with conversation history)
    if (actionId.startsWith('reply_to:')) {
      if (!ADMIN_IDS.includes(authorId)) return;
      const userId = parseInt(actionId.slice('reply_to:'.length), 10);

      const [userRow] = await db
        .select({ username: users.username, firstName: users.firstName })
        .from(users)
        .where(eq(users.telegramId, userId))
        .limit(1);
      const userLabel = userRow?.username
        ? `@${userRow.username}`
        : (userRow?.firstName ?? `#${userId}`);

      // Fetch last 5 messages (both directions) for context
      const recentMsgs = await db
        .select({
          direction: messagesTable.direction,
          content: messagesTable.content,
          createdAt: messagesTable.createdAt,
        })
        .from(messagesTable)
        .where(eq(messagesTable.userId, userId))
        .orderBy(desc(messagesTable.createdAt))
        .limit(5);

      let historyBlock = '';
      if (recentMsgs.length > 0) {
        const lines = recentMsgs.reverse().map((m) => {
          const arrow = m.direction === 'user_to_admin' ? '👤' : '🤖';
          const time = m.createdAt
            ? m.createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            : '';
          const preview = m.content.slice(0, 100) + (m.content.length > 100 ? '…' : '');
          return `${arrow} ${time} ${escapeHtml(preview)}`;
        });
        historyBlock = `\n\n📋 <b>Последние сообщения:</b>\n${lines.join('\n')}\n`;
      }

      await setPendingReply(authorId, { userId, userLabel });
      console.log(`[relay] admin ${authorId} pending reply set → user ${userId} (${userLabel})`);
      await tgSend(
        authorId,
        `✏️ <b>Ответ для ${escapeHtml(userLabel)}</b>${historyBlock}\n` +
          `<i>Напишите ответ — он придёт пользователю анонимно от имени бота.</i>\n` +
          `Отправьте /cancel чтобы отменить.`,
      );
      return;
    }

    // Admin: Order detail with status buttons
    if (actionId.startsWith('admin_order_')) {
      if (!ADMIN_IDS.includes(authorId)) return;
      const orderId = parseInt(actionId.slice('admin_order_'.length), 10);

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) {
        await thread?.post('❌ Заказ не найден.');
        return;
      }

      const items = await db
        .select({ quantity: orderItems.quantity, price: orderItems.priceUsdt, name: products.name })
        .from(orderItems)
        .innerJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, orderId));

      const itemLines = items.map(
        (i) => `• ${i.name} × ${i.quantity} — $${parseFloat(i.price).toFixed(2)} USDT`,
      );
      const emoji = STATUS_EMOJI[order.status] ?? '❓';
      const date = order.createdAt?.toLocaleDateString('ru-RU') ?? '—';
      const summary =
        `📦 **Заказ #${order.id}**\n\n` +
        `👤 Пользователь: #${order.userId}\n` +
        `💰 Сумма: $${order.totalUsdt} USDT\n` +
        `📊 Статус: ${emoji} ${order.status}\n` +
        `🕐 Создан: ${date}` +
        (order.txHash ? `\n🔗 TX: \`${order.txHash}\`` : '') +
        (itemLines.length ? `\n\n**Позиции:**\n${itemLines.join('\n')}` : '');

      await thread?.post(
        Card({
          children: [
            CardText(summary),
            Actions(
              (['awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'] as const)
                .filter((s) => s !== order.status)
                .map((s) => Button({ id: `set_status_${order.id}_${s}`, label: `${STATUS_EMOJI[s]} ${s}` })),
            ),
          ],
        }),
      );
      return;
    }

    // Admin: Confirm cancel on a paid order
    if (actionId.startsWith('confirm_cancel_')) {
      if (!ADMIN_IDS.includes(authorId)) return;
      const orderId = parseInt(actionId.slice('confirm_cancel_'.length), 10);
      if (isNaN(orderId) || orderId <= 0) return;
      await cancelOrder(orderId, authorId);
      return;
    }

    // Admin: Apply status change
    if (actionId.startsWith('set_status_')) {
      if (!ADMIN_IDS.includes(authorId)) return;
      // Format: set_status_<orderId>_<status> — status itself may contain underscores
      const withoutPrefix = actionId.slice('set_status_'.length);
      const firstUnderscore = withoutPrefix.indexOf('_');
      const orderId = parseInt(withoutPrefix.slice(0, firstUnderscore), 10);
      const newStatus = withoutPrefix.slice(firstUnderscore + 1);

      if (isNaN(orderId) || orderId <= 0) {
        await thread?.post('❌ Некорректный ID заказа.');
        return;
      }

      if (!VALID_STATUSES.includes(newStatus)) {
        await thread?.post('❌ Неверный статус.');
        return;
      }

      // Guard: cancelling a post-payment order requires confirmation
      if (newStatus === 'cancelled') {
        const [currentOrder] = await db
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);

        const dangerStatuses = ['paid', 'processing', 'shipped', 'delivered'];
        if (currentOrder && dangerStatuses.includes(currentOrder.status)) {
          const statusEmoji = STATUS_EMOJI[currentOrder.status] ?? '';
          await tgSend(
            authorId,
            `⚠️ <b>Внимание!</b> Заказ #${orderId} в статусе <b>${statusEmoji} ${escapeHtml(currentOrder.status)}</b>.\n\n` +
              `Отмена может потребовать возврат средств или отзыв доставки.\nВы уверены?`,
            {
              inline_keyboard: [
                [{ text: '❌ Да, отменить', callback_data: `confirm_cancel_${orderId}` }],
                [{ text: '◀️ Назад', callback_data: `admin_order_${orderId}` }],
              ],
            },
          );
          return;
        }

        // Pre-payment cancel — proceed directly
        await cancelOrder(orderId, authorId);
        return;
      }

      const [updated] = await db
        .update(orders)
        .set({ status: newStatus, ...(newStatus === 'paid' ? { paidAt: new Date() } : {}) })
        .where(eq(orders.id, orderId))
        .returning();

      if (!updated) {
        await thread?.post('❌ Заказ не найден.');
        return;
      }

      await thread?.post(
        `✅ Статус заказа #${orderId} обновлён: ${STATUS_EMOJI[newStatus] ?? ''} **${newStatus}**`,
      );

      if (updated.userId) {
        await notifyOrderStatusChanged(updated.userId, orderId, newStatus);
      }
    }
  });
}
