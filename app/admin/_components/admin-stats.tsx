'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Stats {
  statusCounts: Record<string, number>;
  revenue: {
    total: string; totalCount: number;
    last7: string; last7Count: number;
    last30: string; last30Count: number;
  };
  ordersToday: number;
  users: number;
  products: { total: number; active: number; lowStock: number };
  messages: number;
  suggestions: number;
  topProducts: Array<{ id: number; name: string; sold: number; revenue: string }>;
}

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '🕐 Ожидают',
  awaiting_payment: '💳 К оплате',
  paid: '✅ Оплачены',
  processing: '⚙️ В обработке',
  shipped: '🚚 Отправлены',
  delivered: '📦 Доставлены',
  cancelled: '❌ Отменены',
};

function usdt(value: string): string {
  return `$${parseFloat(value || '0').toFixed(2)}`;
}

export function AdminStats({ authHeaders, onUnauthorized }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/stats', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки (HTTP ${res.status})`); return; }
      const data = await res.json();
      setStats(data);
    } catch {
      setError('Не удалось загрузить статистику.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>;
  if (error) return <p className="text-red-400 text-sm text-center py-10">{error}</p>;
  if (!stats) return null;

  const { statusCounts, revenue, products, topProducts } = stats;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load}>🔄 Обновить</Button>
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border rounded-xl p-3 bg-primary/5">
          <p className="text-xs text-muted-foreground">Выручка всего</p>
          <p className="text-lg font-bold text-primary">{usdt(revenue.total)}</p>
          <p className="text-xs text-muted-foreground">{revenue.totalCount} заказ(ов)</p>
        </div>
        <div className="border rounded-xl p-3 bg-primary/5">
          <p className="text-xs text-muted-foreground">За 30 дней</p>
          <p className="text-lg font-bold text-primary">{usdt(revenue.last30)}</p>
          <p className="text-xs text-muted-foreground">{revenue.last30Count} заказ(ов)</p>
        </div>
        <div className="border rounded-xl p-3">
          <p className="text-xs text-muted-foreground">За 7 дней</p>
          <p className="text-lg font-bold">{usdt(revenue.last7)}</p>
          <p className="text-xs text-muted-foreground">{revenue.last7Count} заказ(ов)</p>
        </div>
        <div className="border rounded-xl p-3">
          <p className="text-xs text-muted-foreground">Сегодня (всего)</p>
          <p className="text-lg font-bold">{stats.ordersToday}</p>
          <p className="text-xs text-muted-foreground">заказ(ов)</p>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-2">
        <div className="border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">👥 Юзеры</p>
          <p className="text-base font-bold">{stats.users}</p>
        </div>
        <div className="border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">🛍️ Товары</p>
          <p className="text-base font-bold">{products.active} / {products.total}</p>
        </div>
        <div className="border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">📉 Мало</p>
          <p className="text-base font-bold text-yellow-400">{products.lowStock}</p>
        </div>
        <div className="border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">💬 Сообщ.</p>
          <p className="text-base font-bold">{stats.messages}</p>
        </div>
        <div className="border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">💡 Идеи</p>
          <p className="text-base font-bold">{stats.suggestions}</p>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="border rounded-xl p-3 space-y-2">
        <p className="text-sm font-semibold">Заказы по статусам</p>
        <div className="space-y-1">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <div key={key} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{statusCounts[key] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top products */}
      {topProducts.length > 0 && (
        <div className="border rounded-xl p-3 space-y-2">
          <p className="text-sm font-semibold">🏆 Топ товары</p>
          <div className="space-y-1.5">
            {topProducts.map((p, i) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span className="truncate">{i + 1}. {p.name}</span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {p.sold} шт · {usdt(p.revenue)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
