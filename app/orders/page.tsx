'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { getTelegramUser } from '@/lib/telegram';

interface OrderItem {
  name: string;
  quantity: number;
  priceUsdt: string;
}

interface Order {
  id: number;
  status: string;
  totalUsdt: string;
  paymentAddress: string;
  txHash: string | null;
  createdAt: string;
  paidAt: string | null;
  items: OrderItem[];
}

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  awaiting_payment: 'secondary',
  paid: 'default',
  processing: 'default',
  shipped: 'default',
  delivered: 'default',
  cancelled: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '🕐 Pending',
  awaiting_payment: '💳 Awaiting Payment',
  paid: '✅ Paid',
  processing: '⚙️ Processing',
  shipped: '🚚 Shipped',
  delivered: '📦 Delivered',
  cancelled: '❌ Cancelled',
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [noUser, setNoUser] = useState(false);

  useEffect(() => {
    const user = getTelegramUser();
    if (!user) {
      setNoUser(true);
      setLoading(false);
      return;
    }

    fetch(`/api/orders?userId=${user.id}`)
      .then((r) => r.json())
      .then((data: Order[]) => setOrders(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground animate-pulse">Loading orders…</p>
      </div>
    );
  }

  if (noUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Open this in Telegram to see your orders.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-muted-foreground">←</button>
        <h1 className="text-lg font-semibold">My Orders</h1>
      </header>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <p className="text-4xl">📦</p>
          <p className="text-muted-foreground">No orders yet.</p>
          <button onClick={() => router.push('/')} className="text-primary text-sm underline">
            Start shopping
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {orders.map((order) => (
            <div key={order.id} className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Order #{order.id}</span>
                <Badge variant={STATUS_COLOR[order.status] ?? 'outline'} className="text-xs">
                  {STATUS_LABEL[order.status] ?? order.status}
                </Badge>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>${parseFloat(order.totalUsdt).toFixed(2)} USDT</span>
                <span>{new Date(order.createdAt).toLocaleDateString()}</span>
              </div>
              {order.items && order.items.length > 0 && (
                <div className="space-y-0.5 pt-1">
                  {order.items.map((item, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {item.name} × {item.quantity} — ${parseFloat(item.priceUsdt).toFixed(2)} USDT
                    </p>
                  ))}
                </div>
              )}
              {order.txHash && (
                <p className="text-xs font-mono text-muted-foreground truncate">
                  TX: {order.txHash}
                </p>
              )}
              {order.status === 'awaiting_payment' && (
                <button
                  onClick={() =>
                    router.push(
                      `/checkout?orderId=${order.id}&address=${order.paymentAddress}&total=${order.totalUsdt}`
                    )
                  }
                  className="text-xs text-primary underline"
                >
                  Show payment address
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
