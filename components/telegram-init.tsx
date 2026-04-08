"use client";

import { useEffect } from "react";
import { detectLocale, useLocale } from "@/lib/i18n";
import { setHeaderColor, setBackgroundColor, getInitData } from "@/lib/telegram";

/**
 * Initializes Telegram WebApp SDK: ready(), expand(), theme colors, locale.
 */
export function TelegramInit() {
  const setLocale = useLocale((s) => s.setLocale);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const twa = window.Telegram.WebApp;
      twa.ready();
      twa.expand();

      // Set header/background to match our dark theme
      setHeaderColor("secondary_bg_color");
      setBackgroundColor("#1f1b2e");
    }
    const locale = detectLocale();
    setLocale(locale);

    // Cache language on the server so the Telegram bot can reply in the
    // user's preferred language (fire-and-forget).
    const raw =
      typeof window !== 'undefined'
        ? window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code
        : undefined;
    if (raw) {
      fetch('/api/user/lang', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': getInitData(),
        },
        body: JSON.stringify({ languageCode: raw }),
      }).catch(() => {});
    }
  }, [setLocale]);

  return null;
}
