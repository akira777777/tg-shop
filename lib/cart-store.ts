'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  productId: number;
  name: string;
  priceUsdt: string;
  quantity: number;
  stock?: number; // optional for backwards-compat with persisted carts
  imageUrl?: string | null;
}

interface CartStore {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (productId: number) => void;
  updateQty: (productId: number, quantity: number) => void;
  clear: () => void;
  total: () => number;
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => {
        const existing = get().items.find((i) => i.productId === item.productId);
        if (existing) {
          const maxQty = item.stock ?? existing.stock ?? Infinity;
          const newQty = Math.min(existing.quantity + 1, maxQty);
          set((s) => ({
            items: s.items.map((i) =>
              i.productId === item.productId ? { ...i, quantity: newQty, stock: item.stock ?? i.stock } : i
            ),
          }));
        } else {
          set((s) => ({ items: [...s.items, { ...item, quantity: 1 }] }));
        }
      },
      removeItem: (productId) =>
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
      updateQty: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId);
          return;
        }
        const item = get().items.find((i) => i.productId === productId);
        const maxQty = item?.stock ?? Infinity;
        set((s) => ({
          items: s.items.map((i) =>
            i.productId === productId ? { ...i, quantity: Math.min(quantity, maxQty) } : i
          ),
        }));
      },
      clear: () => set({ items: [] }),
      total: () =>
        get().items.reduce((sum, i) => sum + parseFloat(i.priceUsdt) * i.quantity, 0),
    }),
    { name: 'tg-shop-cart' }
  )
);
