'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Каталог', icon: '🛍️' },
  { href: '/cart', label: 'Корзина', icon: '🛒' },
  { href: '/orders', label: 'Заказы', icon: '📦' },
  { href: '/suggest', label: 'Идея', icon: '💡' },
];

export function BottomNav() {
  const pathname = usePathname();

  // Don't show on admin, checkout, or product detail pages
  if (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/product/')
  ) {
    return null;
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-background/90 backdrop-blur border-t flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className={active ? 'font-medium' : ''}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
