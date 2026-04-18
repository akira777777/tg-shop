import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error(
    'Missing required env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.'
  );
}

export const redis = new Redis({ url, token });

/**
 * Sliding-window-ish rate limit via INCR + EXPIRE NX pipeline.
 * Returns true when the caller is under the limit; false once the limit for the
 * current window is hit. Mirrors the pattern already used in `app/api/orders/route.ts`
 * so behavior is consistent across HTTP and bot callback entry points.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  // EXPIRE NX — set TTL only on first hit so the crash-between-incr-and-expire
  // race can't leave a key without expiration.
  pipeline.expire(key, windowSeconds, 'NX');
  const [count] = (await pipeline.exec()) as [number, unknown];
  return count <= limit;
}
