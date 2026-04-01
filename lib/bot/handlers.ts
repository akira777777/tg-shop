import { Actions, Button, Card, CardText, LinkButton } from 'chat';
import type { Adapter, Chat, Thread } from 'chat';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages as messagesTable, orderItems, orders, products, users } from '@/lib/db/schema';
import { notifyOrderStatusChanged } from './notifications';
import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';
import { releaseAddress } from '@/lib/tron/pool';
import { invalidateProductsCache } from '@/lib/products-cache';

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

export function registerBotHandlers(bot: Chat<Record<string, Adapter>, ThreadState>): void {
  // ── New DM (first contact, thread not yet subscribed) ─────────────────────
  bot.onDirectMessage(async (thread, message) => {
    const authorId = parseInt(message.author.userId, 10);
    const isAdmin = ADMIN_IDS.includes(authorId);
    const msgText = message.text ?? '';

    await thread.subscribe();

    if (msgText.startsWith('/start') || msgText === '') {
      if (isAdmin) {
        await sendAdminPanel(authorId);
      } else {
        await upsertUser(authorId, message.author.userName, message.author.fullName);
        await sendUserWelcome(authorId);
      }
      return;
    }

    if (msgText.startsWith('/status')) {
      await handleStatus(thread, msgText, authorId);
      return;
    }

    if (msgText.startsWith('/orders')) {
      await handleOrders(authorId);
      return;
    }

    if (msgText.startsWith('/help')) {
      await handleHelp(authorId, isAdmin);
      return;
    }

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
    const authorId = parseInt(message.author.userId, 10);
    const isAdmin = ADMIN_IDS.includes(authorId);
    const msgText = message.text ?? '';

    if (msgText.startsWith('/start')) {
      if (isAdmin) await sendAdminPanel(authorId);
      else await sendUserWelcome(authorId);
      return;
    }

    if (msgText.startsWith('/status')) {
      await handleStatus(thread, msgText, authorId);
      return;
    }

    if (msgText.startsWith('/orders')) {
      await handleOrders(authorId);
      return;
    }

    if (msgText.startsWith('/help')) {
      await handleHelp(authorId, isAdmin);
      return;
    }

    if (isAdmin) {
      if (msgText === '/cancel') {
        await thread.setState({});
        await thread.post('❌ Ответ отменён.');
        return;
      }

      const state = (await thread.state) as ThreadState | null;
      if (state?.pendingUserId) {
        const { pendingUserId, pendingUserLabel } = state;
        await thread.setState({});
        try {
          // Use raw Telegram API (tgSend) instead of Chat SDK openDM().post() —
          // openDM is unreliable in serverless because it depends on Chat SDK
          // thread state being properly initialized across cold starts.
          await tgSend(
            pendingUserId,
            `💬 <b>Ответ менеджера:</b>\n\n${escapeHtml(msgText)}`,
          );
          await thread.post(`✅ Ответ отправлен — ${pendingUserLabel}.`);
          await db
            .insert(messagesTable)
            .values({ userId: pendingUserId, direction: 'admin_to_user', content: msgText })
            .catch((err) => console.error('[relay] DB insert failed:', err));
        } catch (err) {
          console.error('[relay] Failed to deliver admin reply:', err);
          await thread.post('❌ Не удалось доставить сообщение пользователю.');
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

    // Admin: Recent dialogs
    if (actionId === 'admin_dialogs') {
      if (!ADMIN_IDS.includes(authorId)) return;

      const recent = await db
        .select({
          userId: messagesTable.userId,
          content: messagesTable.content,
          username: users.username,
          firstName: users.firstName,
        })
        .from(messagesTable)
        .leftJoin(users, eq(messagesTable.userId, users.telegramId))
        .where(eq(messagesTable.direction, 'user_to_admin'))
        .orderBy(desc(messagesTable.createdAt))
        .limit(20);

      if (!recent.length) {
        await thread?.post('📭 Сообщений от пользователей пока нет.');
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

      const lines = unique.map((m) => {
        const label = m.username ? `@${m.username}` : (m.firstName ?? `#${m.userId}`);
        const preview = m.content.slice(0, 50) + (m.content.length > 50 ? '…' : '');
        return `• **${label}:** _${preview}_`;
      });

      await thread?.post(
        Card({
          title: 'Последние диалоги',
          children: [
            CardText(lines.join('\n')),
            Actions(
              unique.map((m) => {
                const label = m.username ? `@${m.username}` : (m.firstName ?? `#${m.userId}`);
                return Button({ id: `reply_to:${m.userId}`, label: `💬 Ответить ${label}` });
              }),
            ),
          ],
        }),
      );
      return;
    }

    // Admin: Recent orders list
    if (actionId === 'admin_orders') {
      if (!ADMIN_IDS.includes(authorId)) return;

      const recent = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(10);
      if (!recent.length) {
        await thread?.post('📭 Заказов пока нет.');
        return;
      }

      const lines = recent.map(
        (o) =>
          `• #${o.id} — ${STATUS_EMOJI[o.status] ?? '❓'} ${o.status} — $${o.totalUsdt} USDT — User #${o.userId}`,
      );

      await thread?.post(
        Card({
          title: 'Последние заказы',
          children: [
            CardText(lines.join('\n')),
            Actions(recent.map((o) => Button({ id: `admin_order_${o.id}`, label: `📝 #${o.id}` }))),
          ],
        }),
      );
      return;
    }

    // Admin: Set pending reply target
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

      await thread?.setState({ pendingUserId: userId, pendingUserLabel: userLabel });
      await thread?.post(
        `✏️ Напишите ответ для **${userLabel}**\n` +
          `_Он придёт пользователю анонимно от имени бота._\n\n` +
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

      const [updated] = await db
        .update(orders)
        .set({ status: newStatus, ...(newStatus === 'paid' ? { paidAt: new Date() } : {}) })
        .where(eq(orders.id, orderId))
        .returning();

      if (!updated) {
        await thread?.post('❌ Заказ не найден.');
        return;
      }

      // Restore stock and release TRC20 address when admin cancels an order
      if (newStatus === 'cancelled') {
        const items = await db
          .select({ productId: orderItems.productId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        await Promise.allSettled(
          items
            .filter((i) => i.productId != null)
            .map((i) =>
              db.update(products)
                .set({ stock: sql`${products.stock} + ${i.quantity}` })
                .where(eq(products.id, i.productId!))
            )
        );
        if (updated.paymentMethod === 'trc20' && updated.paymentAddress) {
          await releaseAddress(updated.paymentAddress).catch(() => {});
        }
        await invalidateProductsCache().catch(() => {});
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
