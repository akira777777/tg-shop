import { after } from 'next/server';
import { getBot } from '@/lib/bot';
import { setUserLocale } from '@/lib/bot/user-lang';

/**
 * Extract the `from.language_code` from the raw Telegram update and cache it
 * in Redis, then forward the request to Chat SDK unchanged. Chat SDK doesn't
 * expose language_code to handlers, so we snatch it here.
 */
async function cacheLanguageCode(bodyText: string): Promise<void> {
  try {
    const update = JSON.parse(bodyText);
    const from =
      update?.message?.from ??
      update?.edited_message?.from ??
      update?.callback_query?.from ??
      null;
    if (from?.id) {
      await setUserLocale(from.id, from.language_code);
    }
  } catch {
    // ignore — best-effort cache, Chat SDK still processes
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Read body once, cache language, then reconstruct a Request for Chat SDK.
    const bodyText = await request.text();
    await cacheLanguageCode(bodyText);

    const forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    });

    return getBot().webhooks.telegram(forwarded, {
      waitUntil: (task) => after(() => task),
    });
  } catch (err) {
    console.error('[webhook] Fatal error processing update:', err);
    // Return 200 to prevent Telegram from retrying and piling up pending updates
    return new Response('Internal error', { status: 200 });
  }
}
