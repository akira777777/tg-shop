'use client';

import { useEffect } from 'react';
import { detectLocale, useLocale } from '@/lib/i18n';

/**
 * Calls Telegram WebApp.ready() and expand() once the client has mounted.
 * Also detects user locale from Telegram and sets it in the i18n store.
 */
export function TelegramInit() {
  const setLocale = useLocale((s) => s.setLocale);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      const twa = window.Telegram.WebApp;
      twa.ready();
      twa.expand();
      twa.requestFullscreen?.();
    }
    setLocale(detectLocale());
  }, [setLocale]);

  return null;
}
