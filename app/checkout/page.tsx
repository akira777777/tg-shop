'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Separator } from '@/components/ui/separator';
import { getTelegramUser, hapticFeedback } from '@/lib/telegram';

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get('orderId');
  const address = params.get('address');
  const total = params.get('total');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (address && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, address, {
        width: 220,
        color: { dark: '#ffffff', light: '#09090b' },
      });
    }
  }, [address]);

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    hapticFeedback('notification');
    setTimeout(() => setCopied(false), 2000);
  }

  async function confirmPayment() {
    const user = getTelegramUser();
    if (!user || !orderId) return;
    setLoading(true);

    try {
      await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, status: 'awaiting_payment' }),
      });
      setSubmitted(true);
      hapticFeedback('notification');
    } catch {
      // silent — user can try again
    } finally {
      setLoading(false);
    }
  }

  if (!orderId || !address || !total) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Invalid checkout session.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3">
        <h1 className="text-lg font-semibold">💳 Payment</h1>
        <p className="text-xs text-muted-foreground">Order #{orderId}</p>
      </header>

      <div className="flex-1 px-4 py-6 space-y-6">
        {submitted ? (
          <div className="text-center space-y-4 pt-8">
            <p className="text-5xl">⏳</p>
            <h2 className="text-lg font-semibold">Waiting for confirmation</h2>
            <p className="text-sm text-muted-foreground">
              We'll notify you in Telegram once we detect your payment.
              This usually takes 1–3 minutes.
            </p>
            <button onClick={() => router.push('/orders')} className="text-primary text-sm underline">
              View my orders
            </button>
          </div>
        ) : (
          <>
            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount to send</span>
                <span className="font-bold text-primary">{total} USDT</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Network</span>
                <span className="font-medium">Tron (TRC20)</span>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col items-center gap-4">
              <canvas ref={canvasRef} className="rounded-xl" />
              <p className="text-xs text-muted-foreground text-center break-all font-mono">
                {address}
              </p>
              <button
                onClick={copyAddress}
                className="text-xs bg-secondary text-secondary-foreground px-4 py-2 rounded-full font-medium"
              >
                {copied ? '✓ Copied!' : 'Copy address'}
              </button>
            </div>

            <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3">
              <p className="text-xs text-yellow-200/80">
                ⚠️ Send <strong>exactly {total} USDT</strong> on the <strong>Tron (TRC20)</strong> network to this address.
                Sending other tokens or on a different network will result in permanent loss.
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
            {loading ? 'Confirming…' : "I've sent the payment"}
          </button>
          <p className="text-center text-xs text-muted-foreground mt-2">
            We'll verify automatically. This just starts the watch.
          </p>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><p className="text-muted-foreground animate-pulse">Loading…</p></div>}>
      <CheckoutInner />
    </Suspense>
  );
}
