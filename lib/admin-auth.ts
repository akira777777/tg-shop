import { verifyInitData, type TelegramUser } from './telegram-auth';

const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}

/**
 * Verifies Telegram initData HMAC and checks if the authenticated user is an admin.
 * Returns the TelegramUser on success, or null if auth fails or user is not admin.
 */
export function verifyAdmin(initData: string): TelegramUser | null {
  const user = verifyInitData(initData);
  if (!user || !isAdmin(user.id)) return null;
  return user;
}
