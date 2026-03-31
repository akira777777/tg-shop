'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getTelegramUser, getInitData, hapticFeedback } from '@/lib/telegram';

export default function SuggestPage() {
  const router = useRouter();
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const user = getTelegramUser();
    if (!user) {
      setError('Open this in Telegram to submit a suggestion.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({ productName, description }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to submit');
        return;
      }

      setSubmitted(true);
      hapticFeedback('notification');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <p className="text-5xl">🎉</p>
        <h2 className="text-lg font-semibold">Thank you!</h2>
        <p className="text-sm text-muted-foreground">
          Your suggestion has been received. We&apos;ll review it soon.
        </p>
        <button onClick={() => router.push('/')} className="text-primary text-sm underline">
          Back to catalog
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-muted-foreground">←</button>
        <h1 className="text-lg font-semibold">💡 Suggest a Product</h1>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium">Product name *</label>
          <Input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Wireless headphones"
            required
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Description <span className="text-muted-foreground">(optional)</span></label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us more about why you'd like this product…"
            rows={4}
            maxLength={1000}
          />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading || !productName.trim()}
          className="w-full bg-primary text-primary-foreground rounded-lg py-3 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {loading ? 'Submitting…' : 'Submit Suggestion'}
        </button>
      </form>
    </div>
  );
}
