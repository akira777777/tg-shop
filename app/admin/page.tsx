'use client';

import { useMemo, useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { getTelegramUser, getInitData } from '@/lib/telegram';
import { AdminOrders } from './_components/admin-orders';
import { AdminProducts } from './_components/admin-products';
import { AdminSuggestions } from './_components/admin-suggestions';
import { AdminStats } from './_components/admin-stats';
import { AdminUsers } from './_components/admin-users';
import { AdminDialogs } from './_components/admin-dialogs';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('stats');
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
    <div className="min-h-screen pb-8">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">👑 Админ-панель</h1>
      </header>

      <div className="px-4 pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full mb-4 overflow-x-auto no-scrollbar flex">
            <TabsTrigger value="stats" className="flex-1 text-xs">📊 Обзор</TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 text-xs">📦 Заказы</TabsTrigger>
            <TabsTrigger value="products" className="flex-1 text-xs">🛍️ Товары</TabsTrigger>
            <TabsTrigger value="users" className="flex-1 text-xs">👥 Юзеры</TabsTrigger>
            <TabsTrigger value="dialogs" className="flex-1 text-xs">💬 Диалоги</TabsTrigger>
            <TabsTrigger value="suggestions" className="flex-1 text-xs">💡 Идеи</TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            <AdminStats authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>

          <TabsContent value="orders">
            <AdminOrders authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>

          <TabsContent value="products">
            <AdminProducts authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>

          <TabsContent value="users">
            <AdminUsers authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>

          <TabsContent value="dialogs">
            <AdminDialogs authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>

          <TabsContent value="suggestions">
            <AdminSuggestions authHeaders={authHeaders} onUnauthorized={onUnauthorized} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
