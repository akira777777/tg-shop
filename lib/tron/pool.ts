import { redis } from '@/lib/redis';
import { log } from '@/lib/logger';

const POOL_KEY = 'tron:pool:available';
const SEED_LOCK_KEY = 'tron:pool:seed-lock';
const SEED_LOCK_TTL_MS = 5_000; // 5 seconds — enough to complete sadd
// When the free pool drops to or below this many addresses we emit a warn log
// so operators can top the env var up before new orders start failing.
const POOL_LOW_WATER_MARK = 3;

/**
 * Seeds the Redis pool from TRON_DEPOSIT_ADDRESS_POOL env var (comma-separated).
 * Only seeds if the pool is currently empty.
 * Uses a distributed SET NX lock to prevent TOCTOU races on cold starts.
 */
async function seedPoolIfEmpty(): Promise<void> {
  const existing = await redis.scard(POOL_KEY);
  if (existing > 0) return;

  // Acquire a short-lived seed lock — only one instance runs the seed
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(SEED_LOCK_KEY, lockToken, {
    nx: true,
    px: SEED_LOCK_TTL_MS,
  });
  if (acquired !== 'OK') return; // another instance is already seeding

  try {
    // Re-check inside the lock to guard against the TOCTOU window
    const stillEmpty = await redis.scard(POOL_KEY);
    if (stillEmpty > 0) return;

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
  } finally {
    // Release the lock only if we still own it
    const current = await redis.get<string>(SEED_LOCK_KEY);
    if (current === lockToken) {
      await redis.del(SEED_LOCK_KEY);
    }
  }
}

/**
 * Pops one address from the pool atomically.
 * Throws if the pool is exhausted.
 */
export async function acquireAddress(): Promise<string> {
  await seedPoolIfEmpty();
  const address = await redis.spop<string>(POOL_KEY);
  if (!address) {
    log.error({ scope: 'tron-pool', event: 'exhausted' });
    throw new Error('No available deposit addresses. Add more to TRON_DEPOSIT_ADDRESS_POOL.');
  }
  const remaining = await redis.scard(POOL_KEY);
  if (remaining <= POOL_LOW_WATER_MARK) {
    log.warn({ scope: 'tron-pool', event: 'low_water', remaining });
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
