function getTgApiBase(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('[tg] TELEGRAM_BOT_TOKEN is not set');
  return `https://api.telegram.org/bot${token}`;
}

export { ADMIN_IDS } from '@/lib/admin-auth';

export const MINI_APP_URL = process.env.MINI_APP_URL ?? '';

export interface TgSendResult {
  messageId: number;
}

/** Send a message via raw Telegram Bot API. Used for web_app buttons which Chat SDK doesn't expose.
 *  Throws on failure so callers can detect delivery errors. */
export async function tgSend(
  chatId: number | string,
  text: string,
  replyMarkup?: object,
): Promise<TgSendResult> {
  const res = await fetch(`${getTgApiBase()}/sendMessage`, {
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
    const msg = `[tg] sendMessage to ${chatId} failed (${res.status}): ${body}`;
    console.error(msg);
    throw new Error(msg);
  }
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; result?: { message_id?: number } }
    | null;
  const messageId = data?.result?.message_id;
  if (typeof messageId !== 'number') {
    throw new Error(`[tg] sendMessage to ${chatId} returned no message_id`);
  }
  return { messageId };
}

/** Edit an existing Telegram message. `disable_web_page_preview` is on so edited announcements
 *  don't suddenly sprout link cards. */
export async function tgEditMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: object,
): Promise<void> {
  const res = await fetch(`${getTgApiBase()}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = `[tg] editMessageText(${chatId}/${messageId}) failed (${res.status}): ${body}`;
    console.error(msg);
    throw new Error(msg);
  }
}

/** Delete a Telegram message. Bot must have "Delete Messages" permission in the chat.
 *  Messages older than 48 h in groups/channels cannot be deleted by bots — callers should
 *  treat errors as non-fatal. */
export async function tgDeleteMessage(
  chatId: number | string,
  messageId: number,
): Promise<void> {
  const res = await fetch(`${getTgApiBase()}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = `[tg] deleteMessage(${chatId}/${messageId}) failed (${res.status}): ${body}`;
    console.error(msg);
    throw new Error(msg);
  }
}
