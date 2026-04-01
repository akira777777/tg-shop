'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getTelegramUser, getInitData, hapticFeedback } from '@/lib/telegram';
import { useTelegramBackButton } from '@/lib/use-telegram-nav';
import { useT } from '@/lib/i18n';

export default function SuggestPage() {
  useTelegramBackButton();
  const router = useRouter();
  const t = useT();
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const user = getTelegramUser();
    if (!user) { setError(t('suggest.openInTg')); return; }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': getInitData() },
        body: JSON.stringify({ productName, description }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? t('suggest.error')); return; }
      setSubmitted(true);
      hapticFeedback('notification');
    } catch {
      setError(t('suggest.connectionError'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-green-500/15 flex items-center justify-center text-4xl">🎉</div>
        <h2 className="text-lg font-bold">{t('suggest.thanks')}</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {t('suggest.received')}
        </p>
        <button
          onClick={() => router.push('/')}
          className="text-primary text-sm font-medium bg-primary/10 rounded-xl px-5 py-2"
        >
          {t('suggest.backToCatalog')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pb-20">
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('suggest.title')}</h1>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-6 space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-semibold">{t('suggest.nameLabel')}</label>
          <Input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder={t('suggest.namePlaceholder')}
            required
            maxLength={200}
            className="bg-muted/50 border-border/50 rounded-xl"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold">
            {t('suggest.descLabel')} <span className="text-muted-foreground font-normal text-xs">{t('suggest.descLabelOptional')}</span>
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('suggest.descPlaceholder')}
            rows={4}
            maxLength={1000}
            className="bg-muted/50 border-border/50 rounded-xl"
          />
        </div>

        {error && <p className="text-destructive text-sm text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading || !productName.trim()}
          className="w-full bg-primary text-primary-foreground rounded-xl py-3.5 text-sm font-bold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 glow-sm"
        >
          {loading ? t('suggest.submitting') : t('suggest.submit')}
        </button>
      </form>
    </div>
  );
}
