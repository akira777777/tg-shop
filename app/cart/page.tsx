'use client';

import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/cart-store';
import { Separator } from '@/components/ui/separator';
import { getTelegramUser } from '@/lib/telegram';
import { useState } from 'react';

export default function CartPage() {
  const router = useRouter();
  const { items, updateQty, removeItem, total, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCheckout() {
    const user = getTelegramUser();
    if (!user) {
      setError('Open this in Telegram to checkout.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          firstName: user.first_name,
          username: user.username,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create order');
        return;
      }

      clear();
      router.push(`/checkout?orderId=${data.orderId}&address=${data.paymentAddress}&total=${data.totalUsdt}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-4xl">🛒</p>
        <p className="text-muted-foreground">Your cart is empty.</p>
        <button onClick={() => router.push('/')} className="text-primary text-sm underline">
          Browse catalog
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground">←</button>
        <h1 className="text-lg font-semibold">Your Cart</h1>
      </header>

      <div className="flex-1 divide-y">
        {items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center text-xl shrink-0">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover rounded-md" />
              ) : '🛍️'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">${item.priceUsdt} USDT each</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => updateQty(item.productId, item.quantity - 1)}
                className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold"
              >−</button>
              <span className="text-sm w-4 text-center">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.productId, item.quantity + 1)}
                className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-sm font-bold"
              >+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t space-y-3">
        <Separator />
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span>${total().toFixed(6)} USDT</span>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Creating order…' : 'Pay with USDT (TRC20)'}
        </button>
      </div>
    </div>
  );
}
