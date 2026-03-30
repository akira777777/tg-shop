'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cart-store';

export function CartFab() {
  const items = useCart((s) => s.items);
  const total = useCart((s) => s.total);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  if (count === 0) return null;

  return (
    <Link href="/cart">
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-3 bg-primary text-primary-foreground rounded-full px-6 py-3 shadow-lg font-medium text-sm">
          <span>🛒 {count} item{count !== 1 ? 's' : ''}</span>
          <span className="opacity-70">·</span>
          <span>${total().toFixed(2)} USDT</span>
        </div>
      </div>
    </Link>
  );
}
