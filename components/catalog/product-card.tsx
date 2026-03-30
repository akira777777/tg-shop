'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCart } from '@/lib/cart-store';
import { hapticFeedback } from '@/lib/telegram';

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
  const addItem = useCart((s) => s.addItem);
  const outOfStock = product.stock === 0;

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    if (outOfStock) return;
    addItem({
      productId: product.id,
      name: product.name,
      priceUsdt: product.priceUsdt,
      imageUrl: product.imageUrl,
    });
    hapticFeedback('impact');
  }

  return (
    <Link href={`/product/${product.id}`}>
      <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer h-full">
        {product.imageUrl ? (
          <div className="relative w-full aspect-square">
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        ) : (
          <div className="w-full aspect-square bg-muted flex items-center justify-center text-3xl">
            🛍️
          </div>
        )}
        <CardContent className="p-3 space-y-1.5">
          <p className="text-sm font-medium leading-tight line-clamp-2">{product.name}</p>
          <p className="text-sm font-semibold text-primary">${parseFloat(product.priceUsdt).toFixed(2)} USDT</p>
          {outOfStock ? (
            <Badge variant="secondary" className="text-xs">Out of stock</Badge>
          ) : (
            <button
              onClick={handleAdd}
              className="w-full text-xs bg-primary text-primary-foreground rounded-md py-1.5 font-medium hover:bg-primary/90 transition-colors"
            >
              Add to cart
            </button>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
