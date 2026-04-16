'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Announcement {
  id: number;
  text: string;
  createdByAdminId: number;
  source: 'admin_panel' | 'bot_command';
  channelMessageId: number | null;
  sentAt: string | null;
  deletedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface ListResponse {
  broadcastConfigured: boolean;
  announcements: Announcement[];
}

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

const MAX_LEN = 4000;

export function AdminBroadcast({ authHeaders, onUnauthorized }: Props) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<Announcement[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки (HTTP ${res.status})`); return; }
      const data: ListResponse = await res.json();
      setConfigured(data.broadcastConfigured);
      setItems(data.announcements);
    } catch {
      setError('Не удалось загрузить историю.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Текст не может быть пустым');
      return;
    }
    setSending(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (res.status === 503) {
        setError('Канал не настроен. Задайте BROADCAST_CHANNEL_ID в окружении.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error
          ? typeof body.error === 'string'
            ? body.error
            : JSON.stringify(body.error)
          : `HTTP ${res.status}`;
        setError(`Не удалось отправить: ${msg}`);
        return;
      }
      setText('');
      setFlash('Новость отправлена в канал.');
      await load();
    } catch {
      setError('Сетевая ошибка. Повторите попытку.');
    } finally {
      setSending(false);
    }
  }, [text, authHeaders, onUnauthorized, load]);

  const remove = useCallback(async (id: number) => {
    if (!confirm('Удалить пост из канала и скрыть из истории?')) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        setError(`Не удалось удалить (HTTP ${res.status})`);
        return;
      }
      const body = await res.json();
      if (body.channelDeleteError) {
        setFlash(`Скрыто, но пост в канале удалить не удалось: ${body.channelDeleteError}`);
      } else {
        setFlash('Пост удалён.');
      }
      await load();
    } catch {
      setError('Сетевая ошибка.');
    }
  }, [authHeaders, onUnauthorized, load]);

  const remaining = MAX_LEN - text.length;

  return (
    <>
      {configured === false && (
        <div className="mb-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-300">
          ⚠️ Канал не настроен. Админ не сможет отправлять новости, пока не задан
          переменная окружения <code className="font-mono">BROADCAST_CHANNEL_ID</code>.
        </div>
      )}

      <section className="space-y-2 mb-5">
        <h2 className="text-sm font-semibold">📣 Новая новость в канал</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder="Текст объявления. HTML: <b>жирный</b>, <i>курсив</i>, <a href='…'>ссылка</a>."
          className="w-full min-h-[140px] resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          disabled={sending}
        />
        <div className="flex items-center justify-between">
          <span className={`text-xs ${remaining < 100 ? 'text-amber-400' : 'text-muted-foreground'}`}>
            Осталось символов: {remaining}
          </span>
          <Button
            size="sm"
            onClick={send}
            disabled={sending || !text.trim() || configured === false}
          >
            {sending ? 'Отправка…' : 'Отправить'}
          </Button>
        </div>
      </section>

      {error && (
        <p className="text-red-400 text-xs mb-3">{error}</p>
      )}
      {flash && (
        <p className="text-emerald-400 text-xs mb-3">{flash}</p>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">📜 История</h2>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            🔄 Обновить
          </Button>
        </div>

        {loading && items.length === 0 ? (
          <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-center py-10 text-sm">Пока ничего не публиковали.</p>
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <div key={a.id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(a.createdAt).toLocaleString('ru-RU')}
                  </span>
                  <StatusBadge a={a} />
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{a.text}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {a.source === 'bot_command' ? '🤖 /news' : '💻 Админка'}
                    {a.channelMessageId != null && ` · msg #${a.channelMessageId}`}
                  </span>
                  {a.deletedAt == null && (
                    <Button variant="outline" size="sm" onClick={() => remove(a.id)}>
                      🗑️ Удалить
                    </Button>
                  )}
                </div>
                {a.errorMessage && (
                  <p className="text-xs text-red-400 pt-1">Ошибка: {a.errorMessage}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function StatusBadge({ a }: { a: Announcement }) {
  if (a.deletedAt) {
    return <span className="text-xs text-muted-foreground">🗑️ удалено</span>;
  }
  if (a.sentAt) {
    return <span className="text-xs text-emerald-400">✅ отправлено</span>;
  }
  if (a.errorMessage) {
    return <span className="text-xs text-red-400">❌ ошибка</span>;
  }
  return <span className="text-xs text-muted-foreground">⏳ черновик</span>;
}
