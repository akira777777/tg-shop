import { bot } from './index';

export async function notifyPaymentConfirmed(
  userId: number,
  orderId: number,
  txHash: string
): Promise<void> {
  await bot.api.sendMessage(
    userId,
    `✅ *Оплата подтверждена!*\n\nЗаказ *#${orderId}* успешно оплачен.\n\n` +
      `TX: \`${txHash}\`\n\n` +
      `Ваш заказ передан в обработку. Используйте /status ${orderId} для отслеживания.`,
    { parse_mode: 'Markdown' }
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
