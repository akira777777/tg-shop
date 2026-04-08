import { ADMIN_IDS, MINI_APP_URL, tgSend } from './telegram-api';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function explorerLink(txHash: string): string {
  return `https://tronscan.org/#/transaction/${txHash}`;
}

export async function notifyPaymentConfirmed(
  userId: number,
  orderId: number,
  txHash: string,
): Promise<void> {
  const network = 'TRC20 USDT';
  const txUrl = explorerLink(txHash);

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
  itemNames?: string[];
}): Promise<void> {
  const { orderId, userId, totalUsdt, itemCount, username, firstName, itemNames } = params;
  const userLabel = username
    ? `@${escapeHtml(username)}`
    : firstName ? escapeHtml(firstName) : `#${userId}`;

  let itemsLine = `📦 Позиций: ${itemCount}`;
  if (itemNames && itemNames.length > 0) {
    const displayed = itemNames.slice(0, 3).map((n) => escapeHtml(n));
    const suffix = itemNames.length > 3 ? ` и ещё ${itemNames.length - 3}` : '';
    itemsLine = `📦 Товары: ${displayed.join(', ')}${suffix}`;
  }

  const text =
    `🛒 <b>Новый заказ #${orderId}</b>\n\n` +
    `👤 Покупатель: ${userLabel}\n` +
    `💰 Сумма: $${totalUsdt} USDT\n` +
    itemsLine;

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
    awaiting_payment: '💳 Ожидание оплаты. Переведите указанную сумму на адрес из вашего заказа.',
    processing: '⚙️ Ваш заказ принят в обработку.',
    shipped: '🚚 Ваш заказ отправлен!',
    delivered: '📦 Ваш заказ доставлен! Спасибо за покупку.',
    cancelled: '❌ Ваш заказ отменён. Обратитесь к менеджеру для уточнений.',
    paid: '✅ Оплата подтверждена. Ваш заказ обрабатывается.',
  };
  const msg = messages[status];
  if (!msg) return;

  const replyMarkup = status === 'awaiting_payment'
    ? { inline_keyboard: [[{ text: '📦 Мой заказ', web_app: { url: `${MINI_APP_URL}/orders` } }]] }
    : undefined;

  await tgSend(userId, `${msg}\n\n<b>Заказ #${orderId}</b>`, replyMarkup).catch((err) =>
    console.error(`[notify] Failed to notify user ${userId}:`, err),
  );
}

export async function notifyExpiryWarning(
  userId: number,
  orderId: number,
  minutesLeft: number,
): Promise<void> {
  await tgSend(
    userId,
    `⏰ <b>Время оплаты заканчивается!</b>\n\n` +
      `Заказ <b>#${orderId}</b> будет отменён примерно через ${minutesLeft} мин., если оплата не поступит.\n\n` +
      `Если вы уже отправили перевод — дождитесь подтверждения в сети.`,
    { inline_keyboard: [[{ text: '📦 Мой заказ', web_app: { url: `${MINI_APP_URL}/orders` } }]] },
  ).catch((err) =>
    console.error(`[notify] Failed to send expiry warning for order ${orderId}:`, err),
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
