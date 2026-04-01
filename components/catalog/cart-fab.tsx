'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cart-store';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '@/lib/i18n';

export function CartFab() {
  const t = useT();
  const { items, total } = useCart(useShallow((s) => ({ items: s.items, total: s.total })));
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  if (count === 0) return null;

  return (
    <Link href="/cart">
      <div className="fixed left-1/2 -translate-x-1/2 z-50" style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem)' }}>
        <div className="flex items-center gap-3 bg-primary text-primary-foreground rounded-2xl px-5 py-3 shadow-lg glow-primary font-medium text-sm">
          <span className="flex items-center gap-1.5">
            <span className="bg-primary-foreground/20 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">{count}</span>
            {t('nav.cart')}
          </span>
          <span className="w-px h-4 bg-primary-foreground/20" />
          <span className="font-bold">${total().toFixed(2)}</span>
        </div>
      </div>
    </Link>
  );
}
