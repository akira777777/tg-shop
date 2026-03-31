'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCart } from '@/lib/cart-store';
import { Separator } from '@/components/ui/separator';
import { getTelegramUser, getInitData } from '@/lib/telegram';
import { useState } from 'react';

export default function CartPage() {
  const router = useRouter();
  const { items, updateQty, removeItem, total, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'trc20' | 'ton'>('trc20');

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
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          paymentMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create order');
        return;
      }

      clear();
      const checkoutParams = new URLSearchParams({
        orderId: String(data.orderId),
        address: data.paymentAddress,
        total: data.totalUsdt,
        method: data.paymentMethod,
      });
      if (data.paymentAmountTon) checkoutParams.set('tonAmount', data.paymentAmountTon);
      if (data.comment) checkoutParams.set('comment', data.comment);
      router.push(`/checkout?${checkoutParams.toString()}`);
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
    <div className="flex flex-col min-h-screen pb-20" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground">←</button>
        <h1 className="text-lg font-semibold">Your Cart</h1>
      </header>

      <div className="flex-1 divide-y">
        {items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
            <div className="relative w-12 h-12 rounded-md bg-muted flex items-center justify-center text-xl shrink-0 overflow-hidden">
              {item.imageUrl ? (
                <Image src={item.imageUrl} alt={item.name} fill className="object-cover" unoptimized />
              ) : '🛍️'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">${parseFloat(item.priceUsdt).toFixed(2)} USDT each</p>
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
          <span>${total().toFixed(2)} USDT</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setPaymentMethod('trc20')}
            className={`flex-1 text-xs rounded-lg py-2 font-medium border transition-colors ${
              paymentMethod === 'trc20'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border'
            }`}
          >
            💵 USDT (TRC20)
          </button>
          <button
            onClick={() => setPaymentMethod('ton')}
            className={`flex-1 text-xs rounded-lg py-2 font-medium border transition-colors ${
              paymentMethod === 'ton'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border'
            }`}
          >
            💎 TON
          </button>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Creating order…' : `Pay with ${paymentMethod === 'ton' ? 'TON' : 'USDT (TRC20)'}`}
        </button>
      </div>
    </div>
  );
}
