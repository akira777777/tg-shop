'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Suggestion {
  id: number;
  userId: number | null;
  productName: string;
  description: string | null;
  createdAt: string;
}

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

export function AdminSuggestions({ authHeaders, onUnauthorized }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/suggestions', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки предложений (HTTP ${res.status})`); return; }
      setSuggestions(await res.json());
      setLoaded(true);
    } catch {
      setError('Не удалось загрузить предложения. Проверьте соединение.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  if (!loaded && !loading) {
    loadSuggestions();
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" onClick={() => loadSuggestions()}>
          🔄 Обновить
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : suggestions.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">Предложений пока нет.</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <div key={s.id} className="border rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.productName}</span>
                <span className="text-xs text-muted-foreground">User #{s.userId}</span>
              </div>
              {s.description && (
                <p className="text-xs text-muted-foreground">{s.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleDateString('ru-RU')}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
