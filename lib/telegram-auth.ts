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
      .update(process.env.TELEGRAM_BOT_TOKEN ?? '')
      .digest();

    const computed = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computed !== hash) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}
