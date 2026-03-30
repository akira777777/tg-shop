'use client';

import { useEffect } from 'react';

/**
 * Calls Telegram WebApp.ready() and expand() once the client has mounted.
 * Must be a client component — WebApp SDK is only available in the browser.
 */
export function TelegramInit() {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  }, []);

  return null;
}
