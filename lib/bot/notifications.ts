import { InlineKeyboard } from 'grammy';
import { bot } from './index';
import { ADMIN_IDS } from './relay';

const MINI_APP_URL = process.env.TELEGRAM_MINI_APP_URL!;

export async function notifyPaymentConfirmed(
  userId: number,
  orderId: number,
  txHash: string
): Promise<void> {
  const keyboard = new InlineKeyboard().webApp('📦 Мои заказы', `${MINI_APP_URL}/orders`);

  await bot.api.sendMessage(
    userId,
    `✅ *Оплата подтверждена!*\n\nЗаказ *#${orderId}* успешно оплачен.\n\n` +
      `TX: \`${txHash}\`\n\n` +
      `Ваш заказ передан в обработку. Используйте /status ${orderId} для отслеживания.`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  const channelId = process.env.ADMIN_CHANNEL_ID;
  if (channelId) {
    await bot.api.sendMessage(
      channelId,
      `💰 *Новый платёж получен*\n\nЗаказ *#${orderId}* · TX: \`${txHash}\``,
      { parse_mode: 'Markdown' }
    );
  }
}

/** Notify all admins when a new order is placed. */
export async function notifyNewOrder(params: {
  orderId: number;
  userId: number;
  totalUsdt: string;
  itemCount: number;
  username?: string;
  firstName?: string;
}): Promise<void> {
  const { orderId, userId, totalUsdt, itemCount, username, firstName } = params;
  const userLabel = username ? `@${username}` : (firstName ?? `#${userId}`);

  const keyboard = new InlineKeyboard().text(`📝 Управлять #${orderId}`, `admin_order_${orderId}`);
  const text =
    `🛒 *Новый заказ #${orderId}*\n\n` +
    `👤 Покупатель: ${userLabel}\n` +
    `💰 Сумма: $${totalUsdt} USDT\n` +
    `📦 Позиций: ${itemCount}`;

  await Promise.allSettled(
    ADMIN_IDS.map((adminId) =>
      bot.api
        .sendMessage(adminId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
        .catch((err) => console.error(`[notify] Could not reach admin ${adminId}:`, err))
    )
  );
}

const ORDER_STATUS_MESSAGES: Partial<Record<string, string>> = {
  processing: '⚙️ Ваш заказ принят в обработку.',
  shipped: '🚚 Ваш заказ отправлен!',
  delivered: '📦 Ваш заказ доставлен! Спасибо за покупку.',
  cancelled: '❌ Ваш заказ отменён. Обратитесь к менеджеру для уточнений.',
  paid: '✅ Оплата подтверждена. Ваш заказ обрабатывается.',
};

/** Notify a user when an admin changes their order status. */
export async function notifyOrderStatusChanged(
  userId: number,
  orderId: number,
  status: string
): Promise<void> {
  const msg = ORDER_STATUS_MESSAGES[status];
  if (!msg) return;
  await bot.api
    .sendMessage(userId, `${msg}\n\n*Заказ #${orderId}*`, { parse_mode: 'Markdown' })
    .catch((err) => console.error(`[notify] Failed to notify user ${userId}:`, err));
}

/** Notify all admins when a user submits a product suggestion. */
export async function notifyNewSuggestion(params: {
  userId: number;
  productName: string;
  description?: string;
  username?: string;
  firstName?: string;
}): Promise<void> {
  const { userId, productName, description, username, firstName } = params;
  const userLabel = username ? `@${username}` : (firstName ?? `#${userId}`);

  const text =
    `💡 *Новое предложение товара*\n\n` +
    `👤 От: ${userLabel}\n` +
    `📦 Товар: ${productName}` +
    (description ? `\n📝 Описание: ${description}` : '');

  await Promise.allSettled(
    ADMIN_IDS.map((adminId) =>
      bot.api
        .sendMessage(adminId, text, { parse_mode: 'Markdown' })
        .catch((err) => console.error(`[notify] Could not reach admin ${adminId}:`, err))
    )
  );
}
