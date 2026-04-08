'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdminUser {
  telegramId: number;
  username: string | null;
  firstName: string;
  createdAt: string | null;
  orderCount: number;
  totalSpent: string;
  lastOrderAt: string | null;
}

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

export function AdminUsers({ authHeaders, onUnauthorized }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);

  const load = useCallback(async (opts?: { append?: boolean; cursor?: number | null }) => {
    const append = opts?.append ?? false;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (opts?.cursor) params.set('cursor', String(opts.cursor));
      const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки (HTTP ${res.status})`); return; }
      const json = await res.json() as { data: AdminUser[]; nextCursor: number | null };
      setUsers((prev) => append ? [...prev, ...json.data] : json.data);
      setNextCursor(json.nextCursor);
    } catch {
      setError('Не удалось загрузить пользователей.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [authHeaders, onUnauthorized, search]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Поиск: имя, @username, ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm"
        />
        <Button variant="outline" size="sm" onClick={() => load()}>🔄</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">Пользователей не найдено.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const label = u.username ? `@${u.username}` : u.firstName;
            const total = parseFloat(u.totalSpent || '0');
            return (
              <div key={u.telegramId} className="border rounded-xl p-3 space-y-1">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs text-muted-foreground font-mono">#{u.telegramId}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">${total.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{u.orderCount} заказ(ов)</p>
                  </div>
                </div>
                {u.lastOrderAt && (
                  <p className="text-xs text-muted-foreground">
                    Последний заказ: {new Date(u.lastOrderAt).toLocaleDateString('ru-RU')}
                  </p>
                )}
              </div>
            );
          })}
          {nextCursor && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load({ append: true, cursor: nextCursor })}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
