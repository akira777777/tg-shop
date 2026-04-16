'use client';

import { useMemo, useState, useCallback } from 'react';
import { getTelegramUser, getInitData } from '@/lib/telegram';
import { AdminOrders } from './_components/admin-orders';
import { AdminProducts } from './_components/admin-products';
import { AdminSuggestions } from './_components/admin-suggestions';
import { AdminStats } from './_components/admin-stats';
import { AdminUsers } from './_components/admin-users';
import { AdminDialogs } from './_components/admin-dialogs';
import { AdminBroadcast } from './_components/admin-broadcast';

type Tab = 'stats' | 'orders' | 'products' | 'users' | 'dialogs' | 'suggestions' | 'broadcast';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'stats', label: 'Обзор', icon: '📊' },
  { id: 'orders', label: 'Заказы', icon: '📦' },
  { id: 'products', label: 'Товары', icon: '🛍️' },
  { id: 'broadcast', label: 'Канал', icon: '📣' },
  { id: 'users', label: 'Юзеры', icon: '👥' },
  { id: 'dialogs', label: 'Диалоги', icon: '💬' },
  { id: 'suggestions', label: 'Идеи', icon: '💡' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('stats');
  const [unauthorized, setUnauthorized] = useState(false);

  const user = useMemo(() => getTelegramUser(), []);
  const adminId = user?.id ?? null;

  const authHeaders = useCallback(() => ({
    'x-telegram-init-data': getInitData(),
  }), []);

  const onUnauthorized = useCallback(() => setUnauthorized(true), []);

  if (!adminId || unauthorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground text-center px-8">
          {unauthorized ? '⛔ Доступ только для администраторов.' : 'Загрузка…'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pb-8">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
        <div className="px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">👑 Админ-панель</h1>
        </div>

        {/* Scrollable tab bar */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 scroll-smooth no-scrollbar">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted active:scale-95'
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 px-4 pt-4 w-full max-w-2xl mx-auto">
        {activeTab === 'stats' && <AdminStats authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'orders' && <AdminOrders authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'products' && <AdminProducts authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'broadcast' && <AdminBroadcast authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'users' && <AdminUsers authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'dialogs' && <AdminDialogs authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
        {activeTab === 'suggestions' && <AdminSuggestions authHeaders={authHeaders} onUnauthorized={onUnauthorized} />}
      </main>
    </div>
  );
}
