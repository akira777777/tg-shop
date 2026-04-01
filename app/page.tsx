'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProductCard, ProductCardSkeleton } from '@/components/catalog/product-card';
import { CartFab } from '@/components/catalog/cart-fab';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';

interface Product {
  id: number;
  name: string;
  description: string | null;
  priceUsdt: string;
  category: string;
  imageUrl: string | null;
  stock: number;
}

export default function CatalogPage() {
  const t = useT();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('Все');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/products', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('[catalog] Failed to load:', err);
          setError('Не удалось загрузить каталог. Попробуйте позже.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const categories = useMemo(
    () => ['Все', ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const matchCategory = activeTab === 'Все' || p.category === activeTab;
        const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
        return matchCategory && matchSearch;
      }),
    [products, activeTab, search]
  );

  return (
    <div className="pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">{t('catalog.title')}</h1>
          {!loading && (
            <span className="text-xs text-muted-foreground">{filtered.length} товаров</span>
          )}
        </div>
        <div className="relative">
          <Input
            placeholder={t('catalog.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm bg-muted/50 border-border/50 rounded-xl pl-9"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">🔍</span>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="flex items-center justify-center h-64">
          <p className="text-destructive text-sm text-center px-4">{error}</p>
        </div>
      )}

      <div className="px-4 pt-3">
        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide -mx-4 px-4">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`shrink-0 text-xs font-medium rounded-full px-4 py-1.5 transition-all duration-200 ${
                activeTab === cat
                  ? 'bg-primary text-primary-foreground glow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Product grid */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <span className="text-4xl">🔍</span>
                <p className="text-muted-foreground text-sm">{t('catalog.empty')}</p>
              </div>
            )}
          </>
        )}
      </div>

      <CartFab />
    </div>
  );
}
