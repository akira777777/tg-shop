import { Actions, Button, Card, CardText, LinkButton } from 'chat';
import type { Chat, Thread } from 'chat';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages as messagesTable, orderItems, orders, products, users } from '@/lib/db/schema';
import { notifyOrderStatusChanged } from './notifications';
import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';

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
  await db
    .insert(users)
    .values({
      telegramId: authorId,
      username: userName || undefined,
      firstName: fullName.split(' ')[0] ?? 'User',
    })
    .onConflictDoNothing();
}

async function relayToAdmins(
  bot: Chat<any, ThreadState>,
  userId: number,
  userLabel: string,
  text: string,
): Promise<void> {
  for (const adminId of ADMIN_IDS) {
    try {
      const dm = await bot.openDM(String(adminId));
      await dm.subscribe();
      await dm.post(
        Card({
          children: [
            CardText(`📨 Сообщение от ${userLabel}\n\n${text}`),
            Actions([Button({ id: `reply_to:${userId}`, label: '💬 Ответить' })]),
          ],
        }),
      );
    } catch (err) {
      console.error(`[relay] Could not reach admin ${adminId}:`, err);
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
      `Статус: ${emoji} ${order.status.replace('_', ' ')}\n` +
      `Сумма: $${order.totalUsdt} USDT` +
      (order.txHash ? `\nTX: \`${order.txHash}\`` : ''),
  });
}

export function registerBotHandlers(bot: Chat<any, ThreadState>): void {
  // ── New DM (first contact, thread not yet subscribed) ─────────────────────
  bot.onDirectMessage(async (thread, message) => {
    const authorId = parseInt(message.author.userId);
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
    const authorId = parseInt(message.author.userId);
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
          const dm = await bot.openDM(String(pendingUserId));
          await dm.post({ markdown: `💬 **Менеджер:**\n\n${msgText}` });
          await thread.post(`✅ Ответ отправлен — ${pendingUserLabel}.`);
          await db
            .insert(messagesTable)
            .values({ userId: pendingUserId, direction: 'admin_to_user', content: msgText })
            .catch((err) => console.error('[relay] DB insert failed:', err));
        } catch {
          await thread.post('❌ Не удалось доставить сообщение пользователю.');
        }
      }
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
    const authorId = parseInt(user.userId);

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

      await thread?.post(
        `✅ Статус заказа #${orderId} обновлён: ${STATUS_EMOJI[newStatus] ?? ''} **${newStatus}**`,
      );

      if (updated.userId) {
        await notifyOrderStatusChanged(updated.userId, orderId, newStatus);
      }
    }
  });
}
