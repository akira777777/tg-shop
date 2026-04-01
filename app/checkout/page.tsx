'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { getTelegramUser, getInitData, hapticFeedback } from '@/lib/telegram';

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get('orderId');
  const address = params.get('address');
  const total = params.get('total');
  const method = params.get('method') ?? 'trc20';
  const tonAmount = params.get('tonAmount');
  const comment = params.get('comment');

  const isTon = method === 'ton';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [copiedComment, setCopiedComment] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (address && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, address, {
        width: 200,
        margin: 2,
        color: { dark: '#ffffff', light: '#00000000' },
      });
    }
  }, [address]);

  async function copyToClipboard(text: string, setter: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      hapticFeedback('notification');
      setTimeout(() => setter(false), 2000);
    } catch {
      setError('Не удалось скопировать. Скопируйте вручную.');
    }
  }

  async function confirmPayment() {
    const user = getTelegramUser();
    if (!user || !orderId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Ошибка сервера. Попробуйте ещё раз.');
        return;
      }
      setSubmitted(true);
      hapticFeedback('notification');
    } catch {
      setError('Ошибка соединения. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  }

  if (!orderId || !address || !total) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Некорректная сессия оплаты.</p>
      </div>
    );
  }

  const displayAmount = isTon && tonAmount
    ? `${parseFloat(tonAmount).toFixed(2)} TON`
    : `${parseFloat(total).toFixed(2)} USDT`;
  const networkLabel = isTon ? 'TON' : 'Tron (TRC20)';

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3">
        <h1 className="text-lg font-bold">💳 Оплата</h1>
        <p className="text-xs text-muted-foreground">Заказ #{orderId}</p>
      </header>

      <div className="flex-1 px-4 py-6 space-y-5">
        {submitted ? (
          <div className="text-center space-y-4 pt-12">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-4xl mx-auto">⏳</div>
            <h2 className="text-lg font-bold">Ожидание подтверждения</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
              Мы уведомим вас в Telegram, как только обнаружим платёж. Обычно 1–3 минуты.
            </p>
            <button
              onClick={() => router.push('/orders')}
              className="text-primary text-sm font-medium bg-primary/10 rounded-xl px-5 py-2"
            >
              Мои заказы
            </button>
          </div>
        ) : (
          <>
            {/* Amount summary */}
            <div className="surface-elevated rounded-2xl p-4 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Сумма к оплате</span>
                <span className="font-bold text-primary text-base">{displayAmount}</span>
              </div>
              {isTon && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Эквивалент USDT</span>
                  <span className="font-medium">${parseFloat(total).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Сеть</span>
                <span className="font-medium">{networkLabel}</span>
              </div>
            </div>

            {/* QR + Address */}
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 surface-elevated rounded-2xl">
                <canvas ref={canvasRef} className="rounded-xl" />
              </div>
              <p className="text-xs text-muted-foreground text-center break-all font-mono leading-relaxed px-2">
                {address}
              </p>
              <button
                onClick={() => copyToClipboard(address, setCopied)}
                className="text-xs bg-primary/15 text-primary px-5 py-2 rounded-full font-semibold active:scale-95 transition-transform"
              >
                {copied ? '✓ Скопировано!' : 'Копировать адрес'}
              </button>
            </div>

            {/* TON comment */}
            {isTon && comment && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 space-y-2">
                <p className="text-xs text-blue-300 font-semibold">
                  💬 Обязательный комментарий к переводу:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-background/50 rounded-lg px-3 py-1.5 text-blue-200">
                    {comment}
                  </code>
                  <button
                    onClick={() => copyToClipboard(comment, setCopiedComment)}
                    className="text-xs bg-blue-500/20 text-blue-300 px-3 py-1.5 rounded-full font-semibold shrink-0 active:scale-95 transition-transform"
                  >
                    {copiedComment ? '✓' : 'Копировать'}
                  </button>
                </div>
                <p className="text-xs text-blue-300/60">
                  Без комментария платёж не будет привязан к заказу.
                </p>
              </div>
            )}

            {/* Warning */}
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4">
              <p className="text-xs text-yellow-200/80 leading-relaxed">
                {isTon ? (
                  <>
                    ⚠️ Отправьте <strong>ровно {tonAmount ? parseFloat(tonAmount).toFixed(2) : '—'} TON</strong> в сети <strong>TON</strong> с комментарием выше.
                  </>
                ) : (
                  <>
                    ⚠️ Отправьте <strong>ровно {parseFloat(total).toFixed(2)} USDT</strong> в сети <strong>Tron (TRC20)</strong> на указанный адрес.
                  </>
                )}
              </p>
            </div>
          </>
        )}
      </div>

      {!submitted && (
        <div className="p-4 border-t border-border/50 surface-elevated">
          <button
            onClick={confirmPayment}
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 glow-sm"
          >
            {loading ? 'Подтверждение…' : 'Я отправил оплату'}
          </button>
          {error && <p className="text-center text-xs text-destructive mt-2">{error}</p>}
          <p className="text-center text-xs text-muted-foreground mt-2">
            Проверка автоматическая — кнопка запускает мониторинг.
          </p>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><p className="text-muted-foreground animate-pulse">Загрузка…</p></div>}>
      <CheckoutInner />
    </Suspense>
  );
}
