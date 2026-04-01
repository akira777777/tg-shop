'use client';

/**
 * Returns the Telegram WebApp user object, or null when opened outside Telegram.
 */
export function getTelegramUser() {
  if (typeof window === 'undefined') return null;

  const real = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (real) return real;

  if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === 'true') {
    const devId = parseInt(process.env.NEXT_PUBLIC_DEV_TELEGRAM_USER_ID ?? '0', 10);
    if (devId) return { id: devId, first_name: 'DevUser', username: 'devuser' };
  }

  return null;
}

export function getInitData(): string {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData ?? '';
}

export function closeMiniApp() {
  window.Telegram?.WebApp?.close();
}

export function hapticFeedback(type: 'impact' | 'notification' = 'impact') {
  if (type === 'impact') {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
  } else {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  }
}

// ── MainButton ───────────────────────────────────────────────────────────────

export function showMainButton(text: string, onClick: () => void) {
  const btn = window.Telegram?.WebApp?.MainButton;
  if (!btn) return;
  btn.setText(text);
  btn.onClick(onClick);
  btn.show();
}

export function hideMainButton() {
  const btn = window.Telegram?.WebApp?.MainButton;
  if (!btn) return;
  btn.offClick();
  btn.hide();
}

export function setMainButtonLoading(loading: boolean) {
  const btn = window.Telegram?.WebApp?.MainButton;
  if (!btn) return;
  if (loading) btn.showProgress(false);
  else btn.hideProgress();
}

// ── BackButton ───────────────────────────────────────────────────────────────

export function showBackButton(onClick: () => void) {
  const bb = window.Telegram?.WebApp?.BackButton;
  if (!bb) return;
  bb.onClick(onClick);
  bb.show();
}

export function hideBackButton() {
  const bb = window.Telegram?.WebApp?.BackButton;
  if (!bb) return;
  bb.offClick();
  bb.hide();
}

// ── Theme ────────────────────────────────────────────────────────────────────

export function setHeaderColor(color: string) {
  try {
    window.Telegram?.WebApp?.setHeaderColor?.(color as 'bg_color' | 'secondary_bg_color');
  } catch { /* older clients may not support this */ }
}

export function setBackgroundColor(color: string) {
  try {
    window.Telegram?.WebApp?.setBackgroundColor?.(color);
  } catch { /* older clients may not support this */ }
}

// Extend window type for TS
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        requestFullscreen?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        initData: string;
        initDataUnsafe: {
          user?: { id: number; first_name: string; username?: string; language_code?: string };
        };
        themeParams?: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
          header_bg_color?: string;
          accent_text_color?: string;
          section_bg_color?: string;
          section_header_text_color?: string;
          subtitle_text_color?: string;
          destructive_text_color?: string;
        };
        HapticFeedback: {
          impactOccurred: (style: string) => void;
          notificationOccurred: (type: string) => void;
        };
        MainButton: {
          setText: (text: string) => void;
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb?: () => void) => void;
          showProgress: (leaveActive: boolean) => void;
          hideProgress: () => void;
          isVisible: boolean;
          isProgressVisible: boolean;
        };
        BackButton: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb?: () => void) => void;
          isVisible: boolean;
        };
        version?: string;
      };
    };
  }
}
