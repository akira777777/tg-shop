import { bot } from './index';

export async function notifyPaymentConfirmed(
  userId: number,
  orderId: number,
  txHash: string
): Promise<void> {
  // Notify the customer
  await bot.api.sendMessage(
    userId,
    `✅ *Payment confirmed!*\n\nOrder *#${orderId}* has been paid.\n\n` +
      `TX: \`${txHash}\`\n\n` +
      `Your order is now being processed. Use /status ${orderId} to track it.`,
    { parse_mode: 'Markdown' }
  );

  // Optionally broadcast to an admin channel (set ADMIN_CHANNEL_ID to enable)
  const channelId = process.env.ADMIN_CHANNEL_ID;
  if (channelId) {
    await bot.api.sendMessage(
      channelId,
      `💰 *New payment received*\n\nOrder *#${orderId}* · TX: \`${txHash}\``,
      { parse_mode: 'Markdown' }
    );
  }
}
