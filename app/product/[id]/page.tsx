'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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

export default function ProductPage() {
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
        <p className="text-muted-foreground animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Product not found.</p>
        <button onClick={() => router.back()} className="text-primary text-sm underline">
          Go back
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
    });
    hapticFeedback('impact');
  }

  return (
    <div className="flex flex-col min-h-screen">
      <button
        onClick={() => router.back()}
        className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur rounded-full p-2 text-sm"
      >
        ← Back
      </button>

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
        <div className="w-full aspect-square bg-muted flex items-center justify-center text-6xl">
          🛍️
        </div>
      )}

      <div className="flex-1 p-5 space-y-4">
        <div className="space-y-1">
          <Badge variant="secondary" className="text-xs">{product.category}</Badge>
          <h1 className="text-xl font-semibold leading-tight">{product.name}</h1>
          <p className="text-2xl font-bold text-primary">${parseFloat(product.priceUsdt).toFixed(2)} USDT</p>
        </div>

        {product.description && (
          <>
            <Separator />
            <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
        </p>
      </div>

      <div className="p-4 border-t">
        {product.stock === 0 ? (
          <div className="w-full bg-muted text-muted-foreground text-center rounded-lg py-3 text-sm">
            Out of stock
          </div>
        ) : inCart ? (
          <button
            onClick={() => router.push('/cart')}
            className="w-full bg-secondary text-secondary-foreground rounded-lg py-3 text-sm font-medium"
          >
            View cart ({inCart.quantity} added)
          </button>
        ) : (
          <button
            onClick={handleAdd}
            className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Add to cart — ${parseFloat(product.priceUsdt).toFixed(2)} USDT
          </button>
        )}
      </div>
    </div>
  );
}
