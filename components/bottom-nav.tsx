'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useCart } from '@/lib/cart-store';
import { getInitData } from '@/lib/telegram';

const NAV_ITEMS: { href: string; labelKey: TranslationKey; icon: string }[] = [
  { href: '/', labelKey: 'nav.catalog', icon: '🛍️' },
  { href: '/cart', labelKey: 'nav.cart', icon: '🛒' },
  { href: '/orders', labelKey: 'nav.orders', icon: '📦' },
  { href: '/suggest', labelKey: 'nav.idea', icon: '💡' },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useT();
  const cartCount = useCart((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const initData = getInitData();
    if (!initData) return;
    fetch('/api/admin/me', {
      headers: { 'x-telegram-init-data': initData },
    })
      .then((r) => {
        if (r.ok) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/product/')
  ) {
    return null;
  }

  const items = isAdmin
    ? [...NAV_ITEMS, { href: '/admin', labelKey: 'nav.admin' as TranslationKey, icon: '⚙️' }]
    : NAV_ITEMS;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 glass border-t border-border/50 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ href, labelKey, icon }) => {
        const active = pathname === href;
        const isCart = href === '/cart';
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 text-xs transition-all duration-200 ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <span className="relative text-lg leading-none">
              {icon}
              {isCart && cartCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {cartCount}
                </span>
              )}
            </span>
            <span className={active ? 'font-semibold' : 'font-medium'}>{t(labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
