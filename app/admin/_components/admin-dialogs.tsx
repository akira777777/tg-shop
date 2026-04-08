'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Dialog {
  userId: number;
  username: string | null;
  firstName: string | null;
  lastMessage: string;
  lastAt: string;
  totalCount: number;
  userCount: number;
}

interface Message {
  id: number;
  userId: number;
  direction: string;
  content: string;
  createdAt: string;
}

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

export function AdminDialogs({ authHeaders, onUnauthorized }: Props) {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>('');
  const [history, setHistory] = useState<Message[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const loadDialogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dialogs', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка (HTTP ${res.status})`); return; }
      const json = await res.json();
      setDialogs(json.data ?? []);
    } catch {
      setError('Не удалось загрузить диалоги.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  useEffect(() => { loadDialogs(); }, [loadDialogs]);

  const openDialog = useCallback(async (d: Dialog) => {
    setActiveUserId(d.userId);
    setActiveLabel(d.username ? `@${d.username}` : (d.firstName ?? `#${d.userId}`));
    setHistoryLoading(true);
    setHistory([]);
    setSendResult(null);
    try {
      const res = await fetch(`/api/admin/dialogs/${d.userId}`, { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка (HTTP ${res.status})`); return; }
      const json = await res.json();
      setHistory(json.messages ?? []);
    } catch {
      setError('Не удалось загрузить историю.');
    } finally {
      setHistoryLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  const sendReply = useCallback(async () => {
    if (!activeUserId || !reply.trim() || sending) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/admin/dialogs/${activeUserId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: reply.trim() }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSendResult((data as { error?: string }).error ?? `Ошибка (HTTP ${res.status})`);
        return;
      }
      // Optimistically append
      setHistory((prev) => [
        ...prev,
        {
          id: Date.now(),
          userId: activeUserId,
          direction: 'admin_to_user',
          content: reply.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
      setReply('');
      setSendResult('✅ Отправлено');
    } catch {
      setSendResult('❌ Сетевая ошибка');
    } finally {
      setSending(false);
    }
  }, [activeUserId, reply, sending, authHeaders, onUnauthorized]);

  // Dialog detail view
  if (activeUserId !== null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setActiveUserId(null); setHistory([]); }}>
            ← Назад
          </Button>
          <p className="text-sm font-semibold truncate">{activeLabel}</p>
        </div>

        <div className="border rounded-xl p-3 max-h-[50vh] overflow-y-auto space-y-2">
          {historyLoading ? (
            <p className="text-muted-foreground text-center py-6 animate-pulse">Загрузка…</p>
          ) : history.length === 0 ? (
            <p className="text-muted-foreground text-center py-6">Сообщений нет.</p>
          ) : history.map((m) => {
            const isUser = m.direction === 'user_to_admin';
            return (
              <div key={m.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${
                  isUser ? 'bg-muted' : 'bg-primary/15 text-primary'
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p className="text-[10px] opacity-60 mt-1">
                    {new Date(m.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Textarea
            placeholder="Ответ пользователю (придёт анонимно от имени бота)…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{sendResult}</span>
            <Button size="sm" onClick={sendReply} disabled={!reply.trim() || sending}>
              {sending ? 'Отправка…' : 'Отправить'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Dialog list
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={loadDialogs}>🔄 Обновить</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : dialogs.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">Диалогов нет.</p>
      ) : (
        <div className="space-y-2">
          {dialogs.map((d) => {
            const label = d.username ? `@${d.username}` : (d.firstName ?? `#${d.userId}`);
            return (
              <button
                key={d.userId}
                onClick={() => openDialog(d)}
                className="w-full border rounded-xl p-3 text-left hover:bg-muted/40 active:scale-[0.99] transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{label}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {d.lastMessage.slice(0, 80)}
                      {d.lastMessage.length > 80 ? '…' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(d.lastAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {d.totalCount} сообщ.
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
