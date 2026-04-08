import { redis } from '@/lib/redis';

/**
 * Self-healing webhook registration. Runs on the cron schedule to make sure
 * the Telegram webhook is always pointing at the current deployment. If the
 * webhook URL is missing, wrong, or has a backlog of errors, re-register it.
 *
 * Redis key `bot:webhook_ok` caches a healthy state for 5 minutes so we don't
 * hammer Telegram's API on every cron tick.
 */
const CACHE_KEY = 'bot:webhook_ok';
const CACHE_TTL_S = 5 * 60;

export async function ensureWebhook(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const base = (process.env.MINI_APP_URL ?? '').replace(/\/$/, '');
  const secret = process.env.WEBHOOK_SECRET ?? '';
  if (!token || !base) return;

  // Cached healthy — skip
  const cached = await redis.get<string>(CACHE_KEY).catch(() => null);
  if (cached === '1') return;

  const expectedUrl = `${base}/api/telegram/webhook`;
  const api = `https://api.telegram.org/bot${token}`;

  try {
    const infoRes = await fetch(`${api}/getWebhookInfo`);
    const info = await infoRes.json();
    const current = info?.result?.url as string | undefined;
    const hasErrors = (info?.result?.last_error_date ?? 0) > 0;

    if (current === expectedUrl && !hasErrors) {
      await redis.set(CACHE_KEY, '1', { ex: CACHE_TTL_S }).catch(() => {});
      return;
    }

    console.warn(
      `[ensureWebhook] Re-registering webhook. current=${current ?? 'none'} expected=${expectedUrl} hasErrors=${hasErrors}`,
    );
    const setRes = await fetch(`${api}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: expectedUrl,
        ...(secret ? { secret_token: secret } : {}),
        drop_pending_updates: false,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      }),
    });
    const setData = await setRes.json();
    if (setData?.ok) {
      await redis.set(CACHE_KEY, '1', { ex: CACHE_TTL_S }).catch(() => {});
      console.log('[ensureWebhook] Webhook re-registered successfully');
    } else {
      console.error('[ensureWebhook] setWebhook failed:', setData);
    }
  } catch (err) {
    console.error('[ensureWebhook] Error:', err);
  }
}
