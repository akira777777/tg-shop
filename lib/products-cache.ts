import { redis } from './redis';
import type { CachedProduct } from './types';

export type { CachedProduct };

export const PRODUCTS_CACHE_KEY = 'catalog:products';
const PRODUCTS_CACHE_TTL = 300; // 5 minutes

export async function getCachedProducts(): Promise<CachedProduct[] | null> {
  return redis.get<CachedProduct[]>(PRODUCTS_CACHE_KEY);
}

export async function setCachedProducts(rows: CachedProduct[]): Promise<void> {
  await redis.set(PRODUCTS_CACHE_KEY, rows, { ex: PRODUCTS_CACHE_TTL });
}

export async function invalidateProductsCache(): Promise<void> {
  await redis.del(PRODUCTS_CACHE_KEY);
}
