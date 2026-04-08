import { redis } from './redis';
import { notifyExpiryWarning } from './bot/notifications';

interface OrderForWarning {
  id: number;
  userId: number | null;
  createdAt: Date | null;
}

/**
 * Fires pre-expiry warning notifications for orders where >70% of TTL has elapsed.
 * Deduplicates via Redis SET NX so each order gets at most one warning per TTL window.
 */
export async function sendExpiryWarnings(
  orders: OrderForWarning[],
  ttlMinutes: number,
): Promise<void> {
  const warningThresholdMs = ttlMinutes * 60 * 1000 * 0.7;
  const now = Date.now();

  for (const order of orders) {
    if (!order.createdAt || !order.userId) continue;
    const elapsed = now - new Date(order.createdAt).getTime();
    if (elapsed < warningThresholdMs) continue;

    const redisKey = `expiry_warn:${order.id}`;
    // nx: set only if not already set — prevents duplicate warnings
    const wasSet = await redis.set(redisKey, '1', { nx: true, ex: ttlMinutes * 60 });
    if (wasSet) {
      const minutesLeft = Math.max(1, Math.round((ttlMinutes * 60 * 1000 - elapsed) / 60_000));
      await notifyExpiryWarning(order.userId, order.id, minutesLeft).catch(() => {});
    }
  }
}
