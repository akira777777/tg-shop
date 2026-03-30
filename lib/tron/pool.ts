import { redis } from '@/lib/redis';

const POOL_KEY = 'tron:pool:available';

/**
 * Seeds the Redis pool from TRON_DEPOSIT_ADDRESS_POOL env var (comma-separated).
 * Only seeds if the pool is currently empty.
 */
async function seedPoolIfEmpty(): Promise<void> {
  const existing = await redis.scard(POOL_KEY);
  if (existing > 0) return;

  const raw = process.env.TRON_DEPOSIT_ADDRESS_POOL ?? '';
  const addresses = raw
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new Error(
      'TRON_DEPOSIT_ADDRESS_POOL is empty. Add TRC20 addresses (comma-separated) to your env.'
    );
  }

  // Upstash sadd accepts (key, member, ...members) — pass as array spread via rest
  await (redis.sadd as (key: string, ...members: string[]) => Promise<number>)(
    POOL_KEY,
    ...addresses
  );
}

/**
 * Pops one address from the pool atomically.
 * Throws if the pool is exhausted.
 */
export async function acquireAddress(): Promise<string> {
  await seedPoolIfEmpty();
  const address = await redis.spop<string>(POOL_KEY);
  if (!address) {
    throw new Error('No available deposit addresses. Add more to TRON_DEPOSIT_ADDRESS_POOL.');
  }
  return address;
}

/**
 * Returns an address back to the available pool (on order expiry or payment).
 */
export async function releaseAddress(address: string): Promise<void> {
  await redis.sadd(POOL_KEY, address);
}

export async function poolSize(): Promise<number> {
  return redis.scard(POOL_KEY);
}
