import { log } from '@/lib/logger';

function getTgApiBase(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('[tg] TELEGRAM_BOT_TOKEN is not set');
  return `https://api.telegram.org/bot${token}`;
}

export { ADMIN_IDS } from '@/lib/admin-auth';

export const MINI_APP_URL = process.env.MINI_APP_URL ?? '';

// Telegram limits per-bot outgoing messages to ~30 msg/sec. Keep concurrent
// in-flight requests below that so a burst (e.g. notifying 3 admins × 10
// expired orders from one cron tick) doesn't hit 429 storms.
const MAX_CONCURRENT_TG_REQUESTS = 20;
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT_TG_REQUESTS) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

// sendMessage text cap is 4096 chars (HTML-parsed). Leave a small margin for
// the ellipsis we append on truncation.
const MAX_TEXT_LENGTH = 4096;

function truncateText(text: string, kind: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  log.warn({ scope: 'tg', event: 'truncate', kind, from: text.length, to: MAX_TEXT_LENGTH });
  return text.slice(0, MAX_TEXT_LENGTH - 1) + '…';
}

interface TelegramErrorBody {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

const MAX_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Low-level POST to Telegram Bot API with retry handling.
 *  Retries 429 (respects retry_after) and 5xx (exponential backoff). Throws
 *  after MAX_RETRIES or on non-retryable 4xx. */
async function callTg(method: string, payload: object): Promise<unknown> {
  await acquireSlot();
  try {
    let attempt = 0;
    while (true) {
      attempt++;
      const res = await fetch(`${getTgApiBase()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return (await res.json().catch(() => null)) as unknown;
      }

      const rawBody = await res.text().catch(() => '');
      let parsed: TelegramErrorBody | null = null;
      try { parsed = JSON.parse(rawBody) as TelegramErrorBody; } catch { /* noop */ }

      const isRateLimited = res.status === 429;
      const isServerError = res.status >= 500 && res.status < 600;
      const retryable = isRateLimited || isServerError;

      if (!retryable || attempt >= MAX_RETRIES) {
        const msg = `[tg] ${method} failed (${res.status}) after ${attempt} attempt(s): ${rawBody}`;
        log.error({ scope: 'tg', event: 'call.failed', method, status: res.status, attempt, body: rawBody });
        throw new Error(msg);
      }

      const retryAfterS = parsed?.parameters?.retry_after;
      const delayMs = isRateLimited && retryAfterS
        ? retryAfterS * 1000 + 100
        : 500 * 2 ** (attempt - 1); // 500ms, 1s, 2s
      log.warn({
        scope: 'tg',
        event: isRateLimited ? 'call.rate_limited' : 'call.retry',
        method,
        status: res.status,
        attempt,
        delayMs,
        retryAfterS,
      });
      await sleep(delayMs);
    }
  } finally {
    releaseSlot();
  }
}

export interface TgSendResult {
  messageId: number;
}

/** Send a message via raw Telegram Bot API. Used for web_app buttons which Chat SDK doesn't expose.
 *  Throws on failure so callers can detect delivery errors. Text > 4096 chars is truncated. */
export async function tgSend(
  chatId: number | string,
  text: string,
  replyMarkup?: object,
): Promise<TgSendResult> {
  const safeText = truncateText(text, `sendMessage to ${chatId}`);
  const data = (await callTg('sendMessage', {
    chat_id: chatId,
    text: safeText,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })) as { ok?: boolean; result?: { message_id?: number } } | null;

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
  const safeText = truncateText(text, `editMessageText(${chatId}/${messageId})`);
  await callTg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: safeText,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** Delete a Telegram message. Bot must have "Delete Messages" permission in the chat.
 *  Messages older than 48 h in groups/channels cannot be deleted by bots — callers should
 *  treat errors as non-fatal. */
export async function tgDeleteMessage(
  chatId: number | string,
  messageId: number,
): Promise<void> {
  await callTg('deleteMessage', { chat_id: chatId, message_id: messageId });
}

/** Acknowledge a callback_query so the client stops showing the loading spinner
 *  on the tapped button. Optionally shows a toast (default) or modal alert. */
export async function tgAnswerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  await callTg('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
    show_alert: showAlert,
  });
}
