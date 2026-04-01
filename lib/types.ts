/** Product as seen by the storefront (active ones only). */
export interface Product {
  id: number;
  name: string;
  description: string | null;
  priceUsdt: string;
  category: string;
  imageUrl: string | null;
  stock: number;
}

/** Product including admin-only fields, used for caching all products. */
export interface CachedProduct extends Product {
  active: boolean;
}
