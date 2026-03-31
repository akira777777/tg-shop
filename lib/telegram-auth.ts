import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

/**
 * Verifies the HMAC-SHA256 signature of Telegram WebApp initData and returns
 * the parsed user object on success, or null if verification fails.
 *
 * Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *   1. Extract and remove the 'hash' field from initData
 *   2. Sort remaining key=value pairs alphabetically and join with '\n'
 *   3. Derive secret = HMAC-SHA256("WebAppData", botToken)
 *   4. Compare HMAC-SHA256(secret, dataCheckString) against hash
 */
export function verifyInitData(initData: string): TelegramUser | null {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('[auth] TELEGRAM_BOT_TOKEN is not set — all initData verification will fail');
      return null;
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest();

    const hashBuf = Buffer.from(hash, 'hex');
    if (computed.length !== hashBuf.length || !crypto.timingSafeEqual(computed, hashBuf)) {
      return null;
    }

    // Reject initData older than 24 hours to prevent replay attacks
    const authDateRaw = params.get('auth_date');
    if (!authDateRaw) return null;
    const authDate = parseInt(authDateRaw, 10);
    const MAX_AGE_SECONDS = 24 * 60 * 60;
    if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}
