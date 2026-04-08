import { verifyInitData, type TelegramUser } from './telegram-auth';

export const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}

/**
 * Verifies Telegram initData HMAC and checks if the authenticated user is an admin.
 * Returns the TelegramUser on success, or null if auth fails or user is not admin.
 *
 * Dev bypass: in development with NEXT_PUBLIC_ALLOW_DEV_AUTH=true, requests
 * without a real initData are treated as the configured dev admin user. This
 * mirrors the client-side bypass in lib/telegram.ts and never runs in prod.
 */
export function verifyAdmin(initData: string): TelegramUser | null {
  const user = verifyInitData(initData);
  if (user && isAdmin(user.id)) return user;

  if (
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true'
  ) {
    const devId = parseInt(process.env.NEXT_PUBLIC_DEV_TELEGRAM_USER_ID ?? '0', 10);
    if (devId && isAdmin(devId)) {
      return { id: devId, first_name: 'DevAdmin', username: 'devadmin' };
    }
  }

  return null;
}
