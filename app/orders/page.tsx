'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTelegramUser, getInitData } from '@/lib/telegram';
import { orderComment } from '@/lib/ton/shared';

interface OrderItem { name: string; quantity: number; priceUsdt: string }
interface Order {
  id: number;
  status: string;
  totalUsdt: string;
  paymentMethod: string;
  paymentAddress: string;
  paymentAmountTon: string | null;
  txHash: string | null;
  createdAt: string;
  paidAt: string | null;
  items: OrderItem[];
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending:           { bg: 'bg-muted/60',        text: 'text-muted-foreground', label: '🕐 Ожидает' },
  awaiting_payment:  { bg: 'bg-yellow-500/15',    text: 'text-yellow-300',       label: '💳 Ожидает оплату' },
  paid:              { bg: 'bg-green-500/15',      text: 'text-green-300',        label: '✅ Оплачен' },
  processing:        { bg: 'bg-blue-500/15',       text: 'text-blue-300',         label: '⚙️ В обработке' },
  shipped:           { bg: 'bg-primary/15',        text: 'text-primary',          label: '🚚 Отправлен' },
  delivered:         { bg: 'bg-green-500/15',      text: 'text-green-300',        label: '📦 Доставлен' },
  cancelled:         { bg: 'bg-destructive/15',    text: 'text-destructive',      label: '❌ Отменён' },
};

export default function OrdersPage() {
  const router = useRouter();
  const user = useMemo(() => getTelegramUser(), []);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(!!user);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/orders', {
      headers: { 'x-telegram-init-data': getInitData() },
      signal: controller.signal,
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: Order[]) => setOrders(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('[orders] Failed to load:', err);
          setFetchError('Не удалось загрузить заказы.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground animate-pulse">Загрузка заказов…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive text-sm text-center px-4">{fetchError}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Откройте в Telegram.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pb-20">
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-muted-foreground text-lg">←</button>
        <h1 className="text-lg font-bold">Мои заказы</h1>
      </header>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center text-4xl">📦</div>
          <p className="text-muted-foreground">Заказов пока нет</p>
          <button
            onClick={() => router.push('/')}
            className="text-primary text-sm font-medium bg-primary/10 rounded-xl px-5 py-2"
          >
            Перейти в каталог
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 space-y-3">
          {orders.map((order) => {
            const style = STATUS_STYLE[order.status] ?? STATUS_STYLE.pending;
            return (
              <div key={order.id} className="surface-elevated rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Заказ #{order.id}</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-primary font-bold">${parseFloat(order.totalUsdt).toFixed(2)} USDT</span>
                  <span className="text-muted-foreground text-xs">{new Date(order.createdAt).toLocaleDateString('ru-RU')}</span>
                </div>
                {order.items?.length > 0 && (
                  <div className="space-y-0.5 pt-1 border-t border-border/30">
                    {order.items.map((item, i) => (
                      <p key={i} className="text-xs text-muted-foreground pt-1">
                        {item.name} × {item.quantity} — ${parseFloat(item.priceUsdt).toFixed(2)}
                      </p>
                    ))}
                  </div>
                )}
                {order.txHash && (
                  <p className="text-xs font-mono text-muted-foreground truncate">TX: {order.txHash}</p>
                )}
                {order.status === 'awaiting_payment' && (
                  <button
                    onClick={() => {
                      const p = new URLSearchParams({
                        orderId: String(order.id),
                        address: order.paymentAddress,
                        total: order.totalUsdt,
                        method: order.paymentMethod,
                      });
                      if (order.paymentAmountTon) p.set('tonAmount', order.paymentAmountTon);
                      if (order.paymentMethod === 'ton') p.set('comment', orderComment(order.id));
                      router.push(`/checkout?${p.toString()}`);
                    }}
                    className="w-full text-xs text-primary font-semibold bg-primary/10 rounded-xl py-2 active:scale-[0.98] transition-transform"
                  >
                    Показать адрес оплаты
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
