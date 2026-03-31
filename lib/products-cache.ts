import { redis } from './redis';

export const PRODUCTS_CACHE_KEY = 'catalog:products';
const PRODUCTS_CACHE_TTL = 300; // 5 minutes

export interface CachedProduct {
  id: number;
  name: string;
  description: string | null;
  priceUsdt: string;
  category: string;
  imageUrl: string | null;
  stock: number;
  active: boolean;
}

export async function getCachedProducts(): Promise<CachedProduct[] | null> {
  return redis.get<CachedProduct[]>(PRODUCTS_CACHE_KEY);
}

export async function setCachedProducts(rows: CachedProduct[]): Promise<void> {
  await redis.set(PRODUCTS_CACHE_KEY, rows, { ex: PRODUCTS_CACHE_TTL });
}

export async function invalidateProductsCache(): Promise<void> {
  await redis.del(PRODUCTS_CACHE_KEY);
}
