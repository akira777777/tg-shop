import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function explorerLink(txHash: string, paymentMethod: 'trc20' | 'ton'): string {
  return paymentMethod === 'ton'
    ? `https://tonscan.org/tx/${txHash}`
    : `https://tronscan.org/#/transaction/${txHash}`;
}

export async function notifyPaymentConfirmed(
  userId: number,
  orderId: number,
  txHash: string,
  paymentMethod: 'trc20' | 'ton' = 'trc20',
): Promise<void> {
  const network = paymentMethod === 'ton' ? 'TON' : 'TRC20 USDT';
  const txUrl = explorerLink(txHash, paymentMethod);

  await tgSend(
    userId,
    `✅ <b>Оплата подтверждена!</b>\n\n` +
      `Заказ <b>#${orderId}</b> успешно оплачен через ${network}.\n\n` +
      `Ваш заказ передан в обработку. Используйте /status ${orderId} для отслеживания.`,
    {
      inline_keyboard: [
        [{ text: '📦 Мои заказы', web_app: { url: `${MINI_APP_URL}/orders` } }],
        [{ text: '🔗 Транзакция', url: txUrl }],
      ],
    },
  );

  const channelId = process.env.ADMIN_CHANNEL_ID;
  if (channelId) {
    await tgSend(
      channelId,
      `💰 <b>Новый платёж получен</b>\n\nЗаказ <b>#${orderId}</b> · ${network} · <a href="${txUrl}">TX</a>`,
    ).catch((err) => console.error('[notify] Channel notification failed:', err));
  }
}

export async function notifyNewOrder(params: {
  orderId: number;
  userId: number;
  totalUsdt: string;
  itemCount: number;
  username?: string;
  firstName?: string;
}): Promise<void> {
  const { orderId, userId, totalUsdt, itemCount, username, firstName } = params;
  const userLabel = username
    ? `@${escapeHtml(username)}`
    : firstName ? escapeHtml(firstName) : `#${userId}`;

  const text =
    `🛒 <b>Новый заказ #${orderId}</b>\n\n` +
    `👤 Покупатель: ${userLabel}\n` +
    `💰 Сумма: $${totalUsdt} USDT\n` +
    `📦 Позиций: ${itemCount}`;

  const results = await Promise.allSettled(
    ADMIN_IDS.map((adminId) =>
      tgSend(adminId, text, {
        inline_keyboard: [
          [{ text: `📝 Управлять #${orderId}`, callback_data: `admin_order_${orderId}` }],
        ],
      }),
    ),
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error(`[notify] Could not reach admin:`, r.reason);
    }
  }
}

export async function notifyOrderExpired(userId: number, orderId: number): Promise<void> {
  await tgSend(
    userId,
    `⏳ <b>Время оплаты истекло</b>\n\nЗаказ <b>#${orderId}</b> отменён — адрес для оплаты больше не действителен.\n\nВы можете оформить новый заказ в каталоге.`,
    { inline_keyboard: [[{ text: '🛍️ В каталог', web_app: { url: MINI_APP_URL } }]] },
  ).catch((err) => console.error(`[notify] Failed to notify user ${userId} of expiry:`, err));
}

export async function notifyOrderStatusChanged(
  userId: number,
  orderId: number,
  status: string,
): Promise<void> {
  const messages: Partial<Record<string, string>> = {
    processing: '⚙️ Ваш заказ принят в обработку.',
    shipped: '🚚 Ваш заказ отправлен!',
    delivered: '📦 Ваш заказ доставлен! Спасибо за покупку.',
    cancelled: '❌ Ваш заказ отменён. Обратитесь к менеджеру для уточнений.',
    paid: '✅ Оплата подтверждена. Ваш заказ обрабатывается.',
  };
  const msg = messages[status];
  if (!msg) return;
  await tgSend(userId, `${msg}\n\n<b>Заказ #${orderId}</b>`).catch((err) =>
    console.error(`[notify] Failed to notify user ${userId}:`, err),
  );
}

export async function notifyNewSuggestion(params: {
  userId: number;
  productName: string;
  description?: string;
  username?: string;
  firstName?: string;
}): Promise<void> {
  const { userId, productName, description, username, firstName } = params;
  const userLabel = username
    ? `@${escapeHtml(username)}`
    : firstName ? escapeHtml(firstName) : `#${userId}`;

  const text =
    `💡 <b>Новое предложение товара</b>\n\n` +
    `👤 От: ${userLabel}\n` +
    `📦 Товар: ${escapeHtml(productName)}` +
    (description ? `\n📝 Описание: ${escapeHtml(description)}` : '');

  const results = await Promise.allSettled(
    ADMIN_IDS.map((adminId) => tgSend(adminId, text)),
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error(`[notify] Could not reach admin:`, r.reason);
    }
  }
}
