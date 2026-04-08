'use client';

import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AdminOrder {
  id: number;
  userId: number | null;
  status: string;
  totalUsdt: string;
  paymentAddress: string;
  txHash: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  'pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled',
];

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  awaiting_payment: 'secondary',
  paid: 'default',
  processing: 'default',
  shipped: 'default',
  delivered: 'default',
  cancelled: 'destructive',
};

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

export function AdminOrders({ authHeaders, onUnauthorized }: Props) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Record<number, string>>({});
  const [updatingOrder, setUpdatingOrder] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/orders', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки заказов (HTTP ${res.status})`); return; }
      const json = await res.json() as { data: AdminOrder[]; nextCursor: number | null };
      setOrders(json.data);
      setNextCursor(json.nextCursor);
      setLoaded(true);
    } catch {
      setError('Не удалось загрузить заказы. Проверьте соединение.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/admin/orders?cursor=${nextCursor}`, { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки (HTTP ${res.status})`); return; }
      const json = await res.json() as { data: AdminOrder[]; nextCursor: number | null };
      setOrders((prev) => [...prev, ...json.data]);
      setNextCursor(json.nextCursor);
    } catch {
      setError('Не удалось загрузить заказы.');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, authHeaders, onUnauthorized]);

  // Auto-load on first render
  if (!loaded && !loading) {
    loadOrders();
  }

  const updateOrderStatus = async (orderId: number) => {
    const newStatus = pendingStatus[orderId];
    if (!newStatus || newStatus === orders.find(o => o.id === orderId)?.status) return;
    setUpdatingOrder(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка обновления заказа (HTTP ${res.status})`); return; }
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
      setPendingStatus((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    } catch {
      setError('Не удалось обновить заказ. Проверьте соединение.');
    } finally {
      setUpdatingOrder(null);
    }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" onClick={() => loadOrders()}>
          🔄 Обновить
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : orders.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">Заказов пока нет.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Заказ #{order.id}</span>
                <Badge variant={STATUS_COLOR[order.status] ?? 'outline'} className="text-xs">
                  {order.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                User #{order.userId} · ${parseFloat(order.totalUsdt).toFixed(2)} USDT ·{' '}
                {new Date(order.createdAt).toLocaleDateString('ru-RU')}
              </p>
              {order.txHash && (
                <p className="text-xs font-mono text-muted-foreground truncate">
                  TX: {order.txHash}
                </p>
              )}
              <div className="flex gap-2">
                <select
                  className="flex-1 text-xs bg-background border rounded px-2 py-1.5 text-foreground"
                  value={pendingStatus[order.id] ?? order.status}
                  onChange={(e) =>
                    setPendingStatus((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs shrink-0"
                  disabled={
                    !pendingStatus[order.id] ||
                    pendingStatus[order.id] === order.status ||
                    updatingOrder === order.id
                  }
                  onClick={() => updateOrderStatus(order.id)}
                >
                  {updatingOrder === order.id ? '…' : 'Обновить'}
                </Button>
              </div>
            </div>
          ))}

          {nextCursor && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
