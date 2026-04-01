'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { showBackButton, hideBackButton } from './telegram';

/**
 * Shows Telegram BackButton on mount, navigates back on press.
 * Hides on unmount.
 */
export function useTelegramBackButton() {
  const router = useRouter();

  useEffect(() => {
    const goBack = () => router.back();
    showBackButton(goBack);
    return () => hideBackButton();
  }, [router]);
}
