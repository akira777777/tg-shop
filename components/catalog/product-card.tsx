'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/lib/cart-store';
import { hapticFeedback } from '@/lib/telegram';
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

export function ProductCard({ product }: { product: Product }) {
  const t = useT();
  const addItem = useCart((s) => s.addItem);
  const outOfStock = product.stock === 0;

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) return;
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
    <Link href={`/product/${product.id}`}>
      <div className="group relative overflow-hidden rounded-2xl bg-card border border-border/60 hover:border-primary/30 transition-all duration-300 h-full flex flex-col">
        {/* Image */}
        <div className="relative w-full aspect-[4/3] overflow-hidden">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-500"
              unoptimized
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center text-4xl">
              🛍️
            </div>
          )}
          {/* Price overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-2 px-3">
            <span className="text-sm font-bold text-white drop-shadow-lg">
              ${parseFloat(product.priceUsdt).toFixed(2)}
            </span>
            <span className="text-xs text-white/60 ml-1">USDT</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-3 flex flex-col gap-2">
          <p className="text-sm font-medium leading-tight line-clamp-2">{product.name}</p>

          {outOfStock ? (
            <div className="mt-auto">
              <span className="inline-block text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
                {t('catalog.outOfStock')}
              </span>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              className="mt-auto w-full text-xs bg-primary/90 text-primary-foreground rounded-xl py-2 font-semibold hover:bg-primary active:scale-[0.97] transition-all duration-150"
            >
              {t('catalog.addToCart')}
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card border border-border/60 h-full flex flex-col animate-pulse">
      <div className="w-full aspect-[4/3] bg-muted" />
      <div className="p-3 space-y-2 flex-1">
        <div className="h-4 bg-muted rounded-lg w-3/4" />
        <div className="h-4 bg-muted rounded-lg w-1/2" />
        <div className="h-8 bg-muted rounded-xl mt-auto" />
      </div>
    </div>
  );
}
