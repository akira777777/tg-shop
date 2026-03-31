'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Separator } from '@/components/ui/separator';
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
        width: 220,
        color: { dark: '#ffffff', light: '#09090b' },
      });
    }
  }, [address]);

  async function copyToClipboard(text: string, setter: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setter(true);
    hapticFeedback('notification');
    setTimeout(() => setter(false), 2000);
  }

  async function confirmPayment() {
    const user = getTelegramUser();
    if (!user || !orderId) return;
    setLoading(true);
    setError(null);

    try {
      await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({}),
      });
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
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3">
        <h1 className="text-lg font-semibold">💳 Оплата</h1>
        <p className="text-xs text-muted-foreground">Заказ #{orderId}</p>
      </header>

      <div className="flex-1 px-4 py-6 space-y-6">
        {submitted ? (
          <div className="text-center space-y-4 pt-8">
            <p className="text-5xl">⏳</p>
            <h2 className="text-lg font-semibold">Ожидание подтверждения</h2>
            <p className="text-sm text-muted-foreground">
              Мы уведомим вас в Telegram, как только обнаружим платёж.
              Обычно это занимает 1–3 минуты.
            </p>
            <button onClick={() => router.push('/orders')} className="text-primary text-sm underline">
              Мои заказы
            </button>
          </div>
        ) : (
          <>
            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Сумма к оплате</span>
                <span className="font-bold text-primary">{displayAmount}</span>
              </div>
              {isTon && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Эквивалент в USDT</span>
                  <span className="font-medium">${parseFloat(total).toFixed(2)} USDT</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Сеть</span>
                <span className="font-medium">{networkLabel}</span>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col items-center gap-4">
              <canvas ref={canvasRef} className="rounded-xl" />
              <p className="text-xs text-muted-foreground text-center break-all font-mono">
                {address}
              </p>
              <button
                onClick={() => copyToClipboard(address, setCopied)}
                className="text-xs bg-secondary text-secondary-foreground px-4 py-2 rounded-full font-medium"
              >
                {copied ? '✓ Скопировано!' : 'Копировать адрес'}
              </button>
            </div>

            {isTon && comment && (
              <>
                <Separator />
                <div className="bg-blue-900/30 border border-blue-700/40 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-blue-200/80 font-medium">
                    💬 Вы ОБЯЗАНЫ указать этот комментарий в переводе:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono bg-background/50 rounded px-2 py-1 text-blue-100">
                      {comment}
                    </code>
                    <button
                      onClick={() => copyToClipboard(comment, setCopiedComment)}
                      className="text-xs bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full font-medium shrink-0"
                    >
                      {copiedComment ? '✓' : 'Копировать'}
                    </button>
                  </div>
                  <p className="text-xs text-blue-200/60">
                    Без этого комментария платёж не будет привязан к вашему заказу.
                  </p>
                </div>
              </>
            )}

            <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3">
              <p className="text-xs text-yellow-200/80">
                {isTon ? (
                  <>
                    ⚠️ Отправьте <strong>ровно {tonAmount ? parseFloat(tonAmount).toFixed(2) : '—'} TON</strong> на
                    этот адрес в сети <strong>TON</strong> с указанным выше комментарием.
                    Перевод без комментария приведёт к потере средств.
                  </>
                ) : (
                  <>
                    ⚠️ Отправьте <strong>ровно {parseFloat(total).toFixed(2)} USDT</strong> в сети <strong>Tron (TRC20)</strong> на этот адрес.
                    Отправка других токенов или через другую сеть приведёт к безвозвратной потере средств.
                  </>
                )}
              </p>
            </div>
          </>
        )}
      </div>

      {!submitted && (
        <div className="p-4 border-t">
          <button
            onClick={confirmPayment}
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {loading ? 'Подтверждение…' : 'Я отправил оплату'}
          </button>
          {error && (
            <p className="text-center text-xs text-red-400 mt-2">{error}</p>
          )}
          <p className="text-center text-xs text-muted-foreground mt-2">
            Мы проверим автоматически — эта кнопка только запускает мониторинг.
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
