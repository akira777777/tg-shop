'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ProductCard } from '@/components/catalog/product-card';
import { CartFab } from '@/components/catalog/cart-fab';
import { Input } from '@/components/ui/input';

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground animate-pulse">Загрузка каталога…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-red-400 text-sm text-center px-4">{error}</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">🛍️ Каталог</h1>
        <Input
          placeholder="Поиск товаров…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
      </header>

      <div className="px-4 pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex gap-1 overflow-x-auto w-full justify-start h-auto flex-wrap bg-transparent p-0">
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat} className="text-xs rounded-full">
                {cat}
              </TabsTrigger>
            ))}
          </TabsList>

          {categories.map((cat) => (
            <TabsContent key={cat} value={cat} className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
              {filtered.length === 0 && (
                <p className="text-center text-muted-foreground py-12">Товаров пока нет.</p>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <CartFab />
    </div>
  );
}
