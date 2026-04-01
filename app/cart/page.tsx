'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCart } from '@/lib/cart-store';
import { getTelegramUser, getInitData } from '@/lib/telegram';
import { useTelegramBackButton } from '@/lib/use-telegram-nav';
import { useState } from 'react';

export default function CartPage() {
  useTelegramBackButton();
  const router = useRouter();
  const { items, updateQty, total, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'trc20' | 'ton'>('trc20');

  async function handleCheckout() {
    const user = getTelegramUser();
    if (!user) {
      setError('Откройте в Telegram для оформления заказа.');
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
        setError(data.error ?? 'Не удалось создать заказ');
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
      setError('Ошибка соединения. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-6">
        <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center text-4xl">🛒</div>
        <p className="text-muted-foreground">Корзина пуста</p>
        <button
          onClick={() => router.push('/')}
          className="text-primary text-sm font-medium bg-primary/10 rounded-xl px-5 py-2"
        >
          Перейти в каталог
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground text-lg">←</button>
        <h1 className="text-lg font-bold">Корзина</h1>
        <span className="text-xs text-muted-foreground ml-auto">{items.length} позиций</span>
      </header>

      <div className="flex-1 divide-y divide-border/50">
        {items.map((item) => (
          <div key={item.productId} className="flex items-center gap-3 px-4 py-3.5">
            <div className="relative w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-xl shrink-0 overflow-hidden">
              {item.imageUrl ? (
                <Image src={item.imageUrl} alt={item.name} fill className="object-cover" unoptimized />
              ) : '🛍️'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">${parseFloat(item.priceUsdt).toFixed(2)} USDT</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => updateQty(item.productId, item.quantity - 1)}
                className="w-8 h-8 rounded-xl bg-muted/80 flex items-center justify-center text-sm font-bold active:scale-95 transition-transform"
              >−</button>
              <span className="text-sm w-6 text-center font-medium">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.productId, item.quantity + 1)}
                className="w-8 h-8 rounded-xl bg-muted/80 flex items-center justify-center text-sm font-bold active:scale-95 transition-transform"
              >+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border/50 space-y-4 surface-elevated">
        <div className="flex justify-between text-lg font-bold">
          <span>Итого</span>
          <span className="text-primary">${total().toFixed(2)} USDT</span>
        </div>

        <div className="flex gap-2">
          {(['trc20', 'ton'] as const).map((method) => (
            <button
              key={method}
              onClick={() => setPaymentMethod(method)}
              className={`flex-1 text-xs rounded-xl py-2.5 font-semibold border transition-all duration-200 ${
                paymentMethod === method
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/60'
              }`}
            >
              {method === 'trc20' ? '💵 USDT (TRC20)' : '💎 TON'}
            </button>
          ))}
        </div>

        {error && <p className="text-destructive text-sm text-center">{error}</p>}
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 glow-sm"
        >
          {loading ? 'Создание заказа…' : `Оплатить через ${paymentMethod === 'ton' ? 'TON' : 'USDT (TRC20)'}`}
        </button>
      </div>
    </div>
  );
}
