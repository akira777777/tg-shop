'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCart } from '@/lib/cart-store';
import { hapticFeedback } from '@/lib/telegram';
import { useTelegramBackButton } from '@/lib/use-telegram-nav';
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

export default function ProductPage() {
  useTelegramBackButton();
  const t = useT();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const addItem = useCart((s) => s.addItem);
  const cartItems = useCart((s) => s.items);
  const inCart = cartItems.find((i) => i.productId === Number(params.id));

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then(async (r) => {
        if (r.status === 404) { setProduct(null); return; }
        setProduct(await r.json());
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground animate-pulse">{t('loading')}</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center text-4xl">🔍</div>
        <p className="text-muted-foreground">{t('product.notFound')}</p>
        <button
          onClick={() => router.back()}
          className="text-primary text-sm font-medium bg-primary/10 rounded-xl px-5 py-2"
        >
          {t('product.back')}
        </button>
      </div>
    );
  }

  function handleAdd() {
    if (!product || product.stock === 0) return;
    addItem({
      productId: product.id,
      name: product.name,
      priceUsdt: product.priceUsdt,
      imageUrl: product.imageUrl,
      stock: product.stock,
    });
    hapticFeedback('impact');
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="absolute top-4 left-4 z-10 glass rounded-full w-10 h-10 flex items-center justify-center text-sm border border-border/50"
      >
        ←
      </button>

      {/* Hero image */}
      {product.imageUrl ? (
        <div className="relative w-full aspect-square">
          <Image src={product.imageUrl} alt={product.name} fill className="object-cover" unoptimized />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>
      ) : (
        <div className="w-full aspect-square bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center text-7xl">
          🛍️
        </div>
      )}

      {/* Details */}
      <div className="flex-1 px-5 py-5 space-y-4 -mt-8 relative z-10">
        <div className="space-y-2">
          <span className="inline-block text-xs font-semibold bg-primary/15 text-primary rounded-full px-3 py-1">
            {product.category}
          </span>
          <h1 className="text-xl font-bold leading-tight">{product.name}</h1>
          <p className="text-2xl font-bold text-primary">${parseFloat(product.priceUsdt).toFixed(2)} <span className="text-base font-medium text-primary/70">USDT</span></p>
        </div>

        {product.description && (
          <div className="border-t border-border/30 pt-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {product.stock > 0
            ? t('catalog.inStock', { count: String(product.stock) })
            : t('catalog.outOfStock')}
        </p>
      </div>

      {/* CTA */}
      <div className="p-4 border-t border-border/50 surface-elevated">
        {product.stock === 0 ? (
          <div className="w-full bg-muted text-muted-foreground text-center rounded-xl py-3.5 text-sm font-medium">
            {t('catalog.outOfStock')}
          </div>
        ) : inCart ? (
          <button
            onClick={() => router.push('/cart')}
            className="w-full bg-secondary text-secondary-foreground rounded-xl py-3.5 text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            {t('product.viewCart', { count: String(inCart.quantity) })}
          </button>
        ) : (
          <button
            onClick={handleAdd}
            className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all glow-sm"
          >
            {t('product.addToCart', { price: parseFloat(product.priceUsdt).toFixed(2) })}
          </button>
        )}
      </div>
    </div>
  );
}
