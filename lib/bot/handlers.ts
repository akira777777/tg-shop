import { Actions, Button, Card, CardText, LinkButton } from 'chat';
import type { Adapter, Chat, Thread } from 'chat';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { announcements, messages as messagesTable, orderItems, orders, products, users } from '@/lib/db/schema';
import { notifyOrderStatusChanged } from './notifications';
import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';
import { getUserLocale, tr } from './user-lang';
import { releaseAddress } from '@/lib/tron/pool';
import { invalidateProductsCache } from '@/lib/products-cache';
import { restoreStock } from '@/lib/restore-stock';
import { checkRateLimit, redis } from '@/lib/redis';
import { isBroadcastConfigured, postAnnouncement } from './broadcast';
import { escapeHtml as sharedEscapeHtml, sendAdminReplyToUser } from './relay';

function parseJsonMaybe<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  return raw as T;
}

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

// Atomic read+delete — prevents two concurrent admin messages (same admin on
// two devices) from both consuming the same pending and double-sending.
async function consumePendingReply(adminId: number): Promise<PendingReply | null> {
  const raw = await redis.getdel<PendingReply | string>(pendingReplyKey(adminId));
  return parseJsonMaybe<PendingReply>(raw);
}
async function clearPendingReply(adminId: number): Promise<void> {
  await redis.del(pendingReplyKey(adminId));
}

// ── Pending-news state (Redis-backed, keyed by adminId) ──────────────────────
// Two-stage: 'awaiting_text' (user sent /news) → 'awaiting_confirm' (user sent
// the body, bot showed preview with Confirm/Cancel buttons).
const PENDING_NEWS_TTL_S = 30 * 60;
const pendingNewsKey = (adminId: number) => `pending_news:${adminId}`;
type PendingNews =
  | { stage: 'awaiting_text' }
  | { stage: 'awaiting_confirm'; text: string };

async function setPendingNews(adminId: number, state: PendingNews): Promise<void> {
  await redis.set(pendingNewsKey(adminId), state, { ex: PENDING_NEWS_TTL_S });
}

// Non-consuming read — used during /news conversation (state needs to persist
// across text messages until the admin confirms or cancels).
async function peekPendingNews(adminId: number): Promise<PendingNews | null> {
  const raw = await redis.get<PendingNews | string>(pendingNewsKey(adminId));
  return parseJsonMaybe<PendingNews>(raw);
}

// Atomic read+delete — used on "Confirm send" button so a double-tap can't
// post the announcement twice.
async function consumePendingNews(adminId: number): Promise<PendingNews | null> {
  const raw = await redis.getdel<PendingNews | string>(pendingNewsKey(adminId));
  return parseJsonMaybe<PendingNews>(raw);
}

async function clearPendingNews(adminId: number): Promise<void> {
  await redis.del(pendingNewsKey(adminId));
}

// Local alias for brevity; canonical implementation lives in ./relay to keep
// admin UI and bot handler escaping in lockstep.
const escapeHtml = sharedEscapeHtml;

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

// Callback-data grammars. We send these ourselves, but a user CAN craft a
// callback_query by inspecting the bot's inline keyboards (desktop dev tools)
// and replaying with a modified payload. Reject anything that doesn't match
// before passing into DB queries.
const CALLBACK_PATTERNS = {
  reply_to: /^reply_to:(\d{1,15})$/,
  admin_order: /^admin_order_(\d{1,10})$/,
  confirm_cancel: /^confirm_cancel_(\d{1,10})$/,
  set_status: /^set_status_(\d{1,10})_([a-z_]{1,30})$/,
  admin_orders_f: /^admin_orders_f:([a-z_]{1,30})$/,
};

// Per-action rate-limits applied inside onAction. Admins get a higher ceiling
// since they legitimately tap through many buttons in the admin panel.
const BOT_ACTION_RATE_USER = { limit: 20, windowS: 60 };
const BOT_ACTION_RATE_ADMIN = { limit: 90, windowS: 60 };

interface ThreadState {
  pendingUserId?: number;
  pendingUserLabel?: string;
}

// Uses raw Telegram API so we can send web_app buttons (Chat SDK doesn't expose them)
async function sendUserWelcome(userId: number): Promise<void> {
  const locale = await getUserLocale(userId);
  await tgSend(
    userId,
    tr('welcome.title', locale),
    {
      inline_keyboard: [
        [{ text: tr('btn.catalog', locale), web_app: { url: MINI_APP_URL } }],
        [
          { text: tr('btn.my_orders', locale), callback_data: 'my_orders' },
          { text: tr('btn.contact_mgr', locale), callback_data: 'contact_manager' },
        ],
        [{ text: tr('btn.suggest', locale), callback_data: 'suggest_product' }],
      ],
    },
  );
}

async function sendAdminPanel(userId: number): Promise<void> {
  await tgSend(
    userId,
    '👑 <b>Панель администратора</b>\n\nОтвечайте на сообщения пользователей — ответ придёт анонимно от имени бота.\n\n<i>Нажмите кнопку «Ответить» рядом с пересланным сообщением.</i>\n\nКоманда <b>/news</b> — отправить объявление в канал.',
    {
      inline_keyboard: [
        [{ text: '💬 Диалоги с пользователями', callback_data: 'admin_dialogs' }],
        [{ text: '📦 Последние заказы', callback_data: 'admin_orders' }],
        [{ text: '📣 Новость в канал', callback_data: 'admin_news' }],
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
  const locale = await getUserLocale(authorId);
  const orderId = parseInt(msgText.replace('/status', '').trim(), 10);
  if (isNaN(orderId)) {
    await thread.post(tr('orders.status_usage', locale));
    return;
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== authorId) {
    await thread.post(tr('orders.not_found', locale));
    return;
  }

  const emoji = STATUS_EMOJI[order.status] ?? '❓';
  const orderLabel = locale === 'ru' ? 'Заказ' : 'Order';
  const statusLabel = locale === 'ru' ? 'Статус' : 'Status';
  const totalLabel = locale === 'ru' ? 'Сумма' : 'Total';
  await thread.post({
    markdown:
      `**${orderLabel} #${order.id}**\n` +
      `${statusLabel}: ${emoji} ${order.status.replaceAll('_', ' ')}\n` +
      `${totalLabel}: $${order.totalUsdt} USDT` +
      (order.txHash ? `\nTX: \`${order.txHash}\`` : ''),
  });
}

async function handleOrders(userId: number): Promise<void> {
  const locale = await getUserLocale(userId);
  const userOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(5);

  if (!userOrders.length) {
    await tgSend(userId, tr('orders.none', locale), {
      inline_keyboard: [
        [{ text: tr('btn.catalog', locale), web_app: { url: MINI_APP_URL } }],
      ],
    });
    return;
  }

  const lines = userOrders.map(
    (o) => `${STATUS_EMOJI[o.status] ?? '❓'} <b>#${o.id}</b> — ${o.status.replaceAll('_', ' ')} — $${o.totalUsdt} USDT`,
  );
  const hasAwaitingPayment = userOrders.some((o) => o.status === 'awaiting_payment');
  await tgSend(
    userId,
    `${tr('orders.list_title', locale)}\n\n${lines.join('\n')}\n\n${tr('orders.status_hint', locale)}`,
    {
      inline_keyboard: [
        ...(hasAwaitingPayment
          ? [[{ text: '💳 Оплатить', web_app: { url: `${MINI_APP_URL}/orders` } }]]
          : []),
        [{ text: tr('btn.all_orders', locale), web_app: { url: `${MINI_APP_URL}/orders` } }],
      ],
    },
  );
}

async function handleHelp(userId: number, isAdmin: boolean): Promise<void> {
  const locale = await getUserLocale(userId);

  const adminHelp =
    `👑 <b>Панель администратора:</b>\n\n` +
    `💬 <b>Диалоги</b> — просмотр сообщений от пользователей\n` +
    `📦 <b>Заказы</b> — управление статусами\n` +
    `📣 <b>/news</b> — отправить объявление в канал\n\n` +
    `Для ответа пользователю нажмите <b>«Ответить»</b> рядом с его сообщением.\n\n` +
    `/start — Панель администратора\n` +
    `/orders — Все заказы\n` +
    `/status &lt;номер&gt; — Детали заказа\n` +
    `/news — Опубликовать новость в канал\n` +
    `/cancel — Отменить текущее действие`;

  await tgSend(userId, isAdmin ? adminHelp : tr('help.user', locale), {
    inline_keyboard: [
      [{ text: tr('btn.catalog', locale), web_app: { url: MINI_APP_URL } }],
    ],
  });
}

/** User-facing cancel: allows owners to cancel their own awaiting_payment/pending orders. */
async function handleUserCancel(msgText: string, authorId: number): Promise<void> {
  const locale = await getUserLocale(authorId);
  const orderId = parseInt(msgText.replace('/cancel', '').trim(), 10);
  if (isNaN(orderId) || orderId <= 0) {
    await tgSend(authorId, tr('cancel.usage', locale));
    return;
  }

  // Fetch the order and verify ownership
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order || order.userId !== authorId) {
    await tgSend(authorId, tr('cancel.not_found', locale));
    return;
  }

  // Guard: only pending or awaiting_payment may be cancelled by the user
  const cancellableStatuses = ['pending', 'awaiting_payment'];
  if (!cancellableStatuses.includes(order.status)) {
    await tgSend(authorId, tr('cancel.not_allowed', locale, { status: order.status }));
    return;
  }

  // Atomically update — re-check status in DB to avoid TOCTOU
  const [updated] = await db
    .update(orders)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.userId, authorId),
        sql`${orders.status} IN ('pending', 'awaiting_payment')`,
      ),
    )
    .returning();

  if (!updated) {
    await tgSend(authorId, tr('cancel.not_found', locale));
    return;
  }

  await restoreStock([orderId], 'user-cancel');

  if (updated.paymentMethod === 'trc20' && updated.paymentAddress) {
    await releaseAddress(updated.paymentAddress).catch((err) =>
      console.error(`[handleUserCancel] Failed to release address for order ${orderId}:`, err),
    );
  }

  await invalidateProductsCache().catch(() => {});
  await tgSend(authorId, tr('cancel.success', locale, { id: String(orderId) }));
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

  if (msgText.startsWith('/cancel')) {
    await handleUserCancel(msgText, authorId);
    return true;
  }

  if (msgText.startsWith('/news')) {
    if (!isAdmin) return false;
    await handleNewsStart(authorId);
    return true;
  }

  return false;
}

async function handleNewsStart(adminId: number): Promise<void> {
  if (!isBroadcastConfigured()) {
    await tgSend(
      adminId,
      '⚠️ Канал не настроен. Задайте <code>BROADCAST_CHANNEL_ID</code> в окружении и перезапустите бота.',
    );
    return;
  }
  // Supersede any stale pending reply — admin is switching intent.
  await clearPendingReply(adminId);
  await setPendingNews(adminId, { stage: 'awaiting_text' });
  await tgSend(
    adminId,
    '📣 <b>Новая новость для канала</b>\n\nПришлите текст одним сообщением.\n' +
      'Поддерживается HTML: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;a href&gt;</code>.\n\n' +
      'Отправьте /cancel чтобы отменить.',
  );
}

async function showNewsPreview(adminId: number, text: string): Promise<void> {
  const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  await tgSend(
    adminId,
    '👁 <b>Предпросмотр</b>\n\n' +
      '<i>Ниже — как пост будет выглядеть в канале:</i>\n\n' +
      '━━━━━━━━━━━━━━\n' +
      preview +
      '\n━━━━━━━━━━━━━━',
    {
      inline_keyboard: [
        [
          { text: '✅ Отправить в канал', callback_data: 'news_confirm' },
          { text: '❌ Отмена', callback_data: 'news_cancel' },
        ],
      ],
    },
  );
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

// Shared admin message handler — used by both onDirectMessage and
// onSubscribedMessage. The Chat SDK's "subscribed" state can be lost across
// serverless cold starts, so admin replies sometimes arrive via onDirectMessage
// instead of onSubscribedMessage. Both paths must consume the pending-reply.
async function handleAdminMessage(
  thread: Thread<ThreadState>,
  message: { text?: string; author: { userId: string; userName: string; fullName: string } },
  authorId: number,
  msgText: string,
): Promise<void> {
  if (msgText === '/cancel') {
    await clearPendingReply(authorId);
    await clearPendingNews(authorId);
    await thread.post('❌ Отменено.');
    return;
  }

  // News composition has priority over any pending reply, since /news is the
  // active intent the admin just initiated. During 'awaiting_confirm', any new
  // text replaces the draft and re-renders the preview — convenient when the
  // admin notices a typo after seeing the preview. Peek (not consume) so the
  // state survives across the text→confirm transition.
  const pendingNews = await peekPendingNews(authorId);
  if (pendingNews) {
    const text = msgText.trim();
    if (!text) {
      await tgSend(authorId, '⚠️ Текст пустой. Пришлите сообщение ещё раз или /cancel.');
      return;
    }
    // Telegram sendMessage text cap is 4096 chars. Reject explicitly so the
    // admin can shorten rather than silently getting a truncated post.
    if (text.length > 4000) {
      await tgSend(
        authorId,
        `⚠️ Текст слишком длинный: <b>${text.length}</b> символов, максимум <b>4000</b>.\n` +
          `Пришлите сокращённую версию или /cancel.`,
      );
      return;
    }
    await setPendingNews(authorId, { stage: 'awaiting_confirm', text });
    await showNewsPreview(authorId, text);
    return;
  }

  // Atomic get+delete so a second concurrent message from the same admin
  // can't re-read the same pending reply and double-send.
  const pending = await consumePendingReply(authorId);
  console.log(`[relay] admin ${authorId} message; pending=`, pending);
  if (pending?.userId) {
    const { userId: pendingUserId, userLabel: pendingUserLabel } = pending;
    const adminLabel = message.author.userName
      ? `@${message.author.userName}`
      : message.author.fullName;
    try {
      await sendAdminReplyToUser({
        adminId: authorId,
        userId: pendingUserId,
        userLabel: pendingUserLabel,
        adminLabel,
        content: msgText,
      });
      await thread.post(`✅ Ответ отправлен — ${pendingUserLabel}.`);
    } catch (err) {
      console.error('[relay] Failed to deliver admin reply:', err);
      await thread.post(
        `❌ Не удалось доставить сообщение пользователю #${pendingUserId}.\n\n<i>${escapeHtml(String(err))}</i>`,
      );
    }
    return;
  }

  await sendAdminPanel(authorId);
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
      await handleAdminMessage(thread, message, authorId, msgText);
    } else {
      await upsertUser(authorId, message.author.userName, message.author.fullName);
      await relayToAdmins(bot, authorId, message.author.fullName, msgText);
      const userLocale = await getUserLocale(authorId);
      await thread.post(tr('contact.sent', userLocale));
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
      await handleAdminMessage(thread, message, authorId, msgText);
      return;
    }

    // Regular user message relay
    await relayToAdmins(bot, authorId, message.author.fullName, msgText);
    const userLocale = await getUserLocale(authorId);
    await thread.post(tr('contact.sent_short', userLocale));
    await db
      .insert(messagesTable)
      .values({ userId: authorId, direction: 'user_to_admin', content: msgText })
      .catch((err) => console.error('[relay] DB insert failed:', err));
  });

  // ── Actions (inline keyboard callbacks) ───────────────────────────────────
  // The Telegram adapter auto-ACKs callback_query (see
  // @chat-adapter/telegram:handleCallbackQuery), so we don't manually call
  // answerCallbackQuery here — the spinner clears on its own.
  bot.onAction(async (event) => {
    const { actionId, user, thread } = event;
    const authorId = parseInt(user.userId, 10);
    const isAdmin = ADMIN_IDS.includes(authorId);

    // Rate-limit: prevent button-spam from hammering DB + Telegram API.
    // Key includes isAdmin so ban-evasion via admin impersonation is moot.
    const rate = isAdmin ? BOT_ACTION_RATE_ADMIN : BOT_ACTION_RATE_USER;
    const allowed = await checkRateLimit(
      `ratelimit:bot_action:${authorId}`,
      rate.limit,
      rate.windowS,
    );
    if (!allowed) {
      console.warn(`[bot] action rate-limit hit: user=${authorId} action=${actionId}`);
      // The auto-ack already cleared the spinner; a follow-up DM is the only
      // way to surface rate-limit feedback since the adapter's silent ACK
      // leaves no room for an alert toast.
      await tgSend(authorId, '⏳ Слишком много действий. Подождите минуту.').catch(
        (err) => console.error('[bot] rate-limit notice failed:', err),
      );
      return;
    }

    // User: My Orders
    if (actionId === 'my_orders') {
      await handleOrders(authorId);
      return;
    }

    // User: Contact Manager
    if (actionId === 'contact_manager') {
      const locale = await getUserLocale(authorId);
      await thread?.post(tr('contact.intro', locale));
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
      if (!isAdmin) return;

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
      if (!isAdmin) return;
      await sendAdminPanel(authorId);
      return;
    }

    // Admin: start /news from the panel button
    if (actionId === 'admin_news') {
      if (!isAdmin) return;
      await handleNewsStart(authorId);
      return;
    }

    // Admin: confirm sending a prepared news post
    if (actionId === 'news_confirm') {
      if (!isAdmin) return;
      // Atomic consume so a double-tap can't post the same announcement twice.
      const state = await consumePendingNews(authorId);
      if (state?.stage !== 'awaiting_confirm') {
        // If we consumed an awaiting_text (rare: stale button tap), the admin
        // has to restart — the draft body was never stored anyway.
        await tgSend(authorId, '⚠️ Нет новости в очереди. Начните заново с /news.');
        return;
      }
      const { text } = state;

      // Insert draft first so a delivery failure still leaves an audit row.
      const [row] = await db
        .insert(announcements)
        .values({ text, createdByAdminId: authorId, source: 'bot_command' })
        .returning();

      try {
        const messageId = await postAnnouncement(text);
        await db
          .update(announcements)
          .set({ channelMessageId: messageId, sentAt: new Date(), errorMessage: null })
          .where(eq(announcements.id, row.id));
        await tgSend(authorId, `✅ Новость отправлена в канал (msg #${messageId}).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[news] post failed:', err);
        await db
          .update(announcements)
          .set({ errorMessage: msg.slice(0, 500) })
          .where(eq(announcements.id, row.id));
        await tgSend(authorId, `❌ Не удалось отправить: <code>${escapeHtml(msg)}</code>`);
      }
      return;
    }

    // Admin: cancel a prepared news post
    if (actionId === 'news_cancel') {
      if (!isAdmin) return;
      await clearPendingNews(authorId);
      await tgSend(authorId, '❌ Новость отменена.');
      return;
    }

    // Admin: Orders — show filter menu
    if (actionId === 'admin_orders') {
      if (!isAdmin) return;
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
      if (!isAdmin) return;
      const m = CALLBACK_PATTERNS.admin_orders_f.exec(actionId);
      if (!m) return;
      const filter = m[1];
      if (filter !== 'all' && !VALID_STATUSES.includes(filter)) return;

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
      if (!isAdmin) return;
      const m = CALLBACK_PATTERNS.reply_to.exec(actionId);
      if (!m) return;
      const userId = parseInt(m[1], 10);
      if (!Number.isFinite(userId) || userId <= 0) return;

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
      if (!isAdmin) return;
      const m = CALLBACK_PATTERNS.admin_order.exec(actionId);
      if (!m) return;
      const orderId = parseInt(m[1], 10);

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
      if (!isAdmin) return;
      const m = CALLBACK_PATTERNS.confirm_cancel.exec(actionId);
      if (!m) return;
      const orderId = parseInt(m[1], 10);
      if (!Number.isFinite(orderId) || orderId <= 0) return;
      await cancelOrder(orderId, authorId);
      return;
    }

    // Admin: Apply status change
    if (actionId.startsWith('set_status_')) {
      if (!isAdmin) return;
      // Format: set_status_<orderId>_<status>. Regex caps status to a known
      // alphabet so a crafted payload can't inject SQL or invalid enums.
      const m = CALLBACK_PATTERNS.set_status.exec(actionId);
      if (!m) return;
      const orderId = parseInt(m[1], 10);
      const newStatus = m[2];

      if (!Number.isFinite(orderId) || orderId <= 0) return;
      if (!VALID_STATUSES.includes(newStatus)) return;

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
