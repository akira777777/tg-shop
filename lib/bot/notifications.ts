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

  // Tap to jump straight to the order management view (registered in commands.ts)
  const keyboard = new InlineKeyboard().text(`📝 Управлять #${orderId}`, `admin_order_${orderId}`);

  const text =
    `🛒 *Новый заказ #${orderId}*\n\n` +
    `👤 Покупатель: ${userLabel}\n` +
    `💰 Сумма: $${totalUsdt} USDT\n` +
    `📦 Позиций: ${itemCount}`;

  for (const adminId of ADMIN_IDS) {
    await bot.api
      .sendMessage(adminId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
      .catch((err) => console.error(`[notify] Could not reach admin ${adminId}:`, err));
  }
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

  for (const adminId of ADMIN_IDS) {
    await bot.api
      .sendMessage(adminId, text, { parse_mode: 'Markdown' })
      .catch((err) => console.error(`[notify] Could not reach admin ${adminId}:`, err));
  }
}
