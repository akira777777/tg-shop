const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

export function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}
