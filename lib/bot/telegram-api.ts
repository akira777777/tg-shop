const TGAPI = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

export const MINI_APP_URL = process.env.MINI_APP_URL ?? '';

/** Send a message via raw Telegram Bot API. Used for web_app buttons which Chat SDK doesn't expose. */
export async function tgSend(
  chatId: number | string,
  text: string,
  replyMarkup?: object,
): Promise<void> {
  const res = await fetch(`${TGAPI}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[tg] sendMessage to ${chatId} failed (${res.status}):`, body);
  }
}
