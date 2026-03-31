"use client";

import { useEffect } from "react";
import { detectLocale, useLocale } from "@/lib/i18n";

/**
 * Calls Telegram WebApp.ready() and expand() once the client has mounted.
 * Also detects user locale from Telegram and sets it in the i18n store.
 */
export function TelegramInit() {
  const setLocale = useLocale((s) => s.setLocale);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const twa = window.Telegram.WebApp;
      twa.ready();
      twa.expand();
      // Telegram WebApp API is versioned; requestFullscreen isn't available on older clients.
      // Prefer a conservative check to avoid console errors on v6.x.
      const isAtLeast = (minMajor: number, minMinor = 0) => {
        const raw = String((twa as { version?: string }).version ?? "");
        const match = raw.match(/^(\d+)(?:\.(\d+))?/);
        const major = match ? Number(match[1]) : 0;
        const minor = match && match[2] ? Number(match[2]) : 0;
        return major > minMajor || (major === minMajor && minor >= minMinor);
      };

      if (
        isAtLeast(7) &&
        typeof (twa as { requestFullscreen?: () => void }).requestFullscreen ===
          "function"
      ) {
        try {
          (twa as { requestFullscreen: () => void }).requestFullscreen();
        } catch {
          // Ignore: Telegram may reject fullscreen depending on platform/client.
        }
      }
    }
    setLocale(detectLocale());
  }, [setLocale]);

  return null;
}
