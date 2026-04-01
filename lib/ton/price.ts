import { redis } from '@/lib/redis';

const CACHE_KEY = 'ton:usd_price';
const CACHE_TTL = 300; // 5 minutes

/** Fetches TON/USD price from CoinGecko, cached in Redis for 5 min. */
export async function getTonUsdPrice(): Promise<number> {
  const cached = await redis.get<string>(CACHE_KEY);
  if (cached) {
    const cachedPrice = parseFloat(cached);
    if (!isNaN(cachedPrice) && cachedPrice > 0) return cachedPrice;
  }

  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
    { cache: 'no-store', signal: AbortSignal.timeout(8_000) }
  );
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  const price = (data['the-open-network'] as { usd?: number } | undefined)?.usd;
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`Invalid CoinGecko response: unexpected TON price value (${price})`);
  }

  await redis.set(CACHE_KEY, price.toString(), { ex: CACHE_TTL });
  return price;
}

export { orderComment, usdtToTon, toNanoton } from './shared';
