"use client";

import { useEffect } from "react";
import { detectLocale, useLocale } from "@/lib/i18n";
import { setHeaderColor, setBackgroundColor } from "@/lib/telegram";

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
    setLocale(detectLocale());
  }, [setLocale]);

  return null;
}
