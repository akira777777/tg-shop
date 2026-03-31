'use client';

/**
 * Returns the Telegram WebApp user object, or null when opened outside Telegram.
 *
 * In development, if ALLOW_DEV_AUTH=true and VITE_DEV_TELEGRAM_USER_ID is set,
 * returns a synthetic user so the Mini App works outside Telegram without a tunnel.
 */
export function getTelegramUser() {
  if (typeof window === 'undefined') return null;

  const real = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (real) return real;

  // Dev auth bypass — only active when explicitly enabled
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

// Extend window type for TS
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        requestFullscreen?: () => void;
        initData: string;
        initDataUnsafe: {
          user?: { id: number; first_name: string; username?: string };
        };
        HapticFeedback: {
          impactOccurred: (style: string) => void;
          notificationOccurred: (type: string) => void;
        };
      };
    };
  }
}
