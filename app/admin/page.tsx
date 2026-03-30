'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getTelegramUser } from '@/lib/telegram';

interface AdminOrder {
  id: number;
  userId: number | null;
  status: string;
  totalUsdt: string;
  paymentAddress: string;
  txHash: string | null;
  createdAt: string;
}

interface AdminProduct {
  id: number;
  name: string;
  description: string | null;
  priceUsdt: string;
  category: string;
  imageUrl: string | null;
  stock: number;
  active: boolean;
}

interface Suggestion {
  id: number;
  userId: number | null;
  productName: string;
  description: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  'pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled',
];

const STATUS_COLOR: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  awaiting_payment: 'secondary',
  paid: 'default',
  processing: 'default',
  shipped: 'default',
  delivered: 'default',
  cancelled: 'destructive',
};

const EMPTY_PRODUCT = {
  name: '', description: '', priceUsdt: '', category: 'General', stock: '0', imageUrl: '',
};

export default function AdminPage() {
  const [adminId, setAdminId] = useState<number | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [activeTab, setActiveTab] = useState('orders');
  // Track which tabs have already fetched to avoid redundant requests
  const loadedTabs = useRef(new Set<string>());

  // Orders
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Record<number, string>>({});
  const [updatingOrder, setUpdatingOrder] = useState<number | null>(null);

  // Products
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT);
  const [addingProduct, setAddingProduct] = useState(false);

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    const user = getTelegramUser();
    if (!user) { setUnauthorized(true); return; }
    setAdminId(user.id);
  }, []);

  const loadOrders = useCallback(async (id: number) => {
    setOrdersLoading(true);
    try {
      const res = await fetch(`/api/admin/orders?adminId=${id}`);
      if (res.status === 401) { setUnauthorized(true); return; }
      setOrders(await res.json());
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async (id: number) => {
    setProductsLoading(true);
    try {
      const res = await fetch(`/api/admin/products?adminId=${id}`);
      if (res.status === 401) { setUnauthorized(true); return; }
      setProducts(await res.json());
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadSuggestions = useCallback(async (id: number) => {
    setSuggestionsLoading(true);
    try {
      const res = await fetch(`/api/admin/suggestions?adminId=${id}`);
      if (res.status === 401) { setUnauthorized(true); return; }
      setSuggestions(await res.json());
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Load data once per tab activation
  useEffect(() => {
    if (!adminId) return;
    if (!loadedTabs.current.has(activeTab)) {
      loadedTabs.current.add(activeTab);
      if (activeTab === 'orders') loadOrders(adminId);
      if (activeTab === 'products') loadProducts(adminId);
      if (activeTab === 'suggestions') loadSuggestions(adminId);
    }
  }, [adminId, activeTab, loadOrders, loadProducts, loadSuggestions]);

  const updateOrderStatus = async (orderId: number) => {
    if (!adminId) return;
    const newStatus = pendingStatus[orderId];
    if (!newStatus || newStatus === orders.find(o => o.id === orderId)?.status) return;
    setUpdatingOrder(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, status: newStatus }),
      });
      if (res.ok) {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
        setPendingStatus((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
      }
    } finally {
      setUpdatingOrder(null);
    }
  };

  const toggleProduct = async (productId: number, active: boolean) => {
    if (!adminId) return;
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId, active }),
    });
    if (res.ok) {
      setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, active } : p));
    }
  };

  const createProduct = async () => {
    if (!adminId || !newProduct.name || !newProduct.priceUsdt) return;
    setAddingProduct(true);
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId,
          name: newProduct.name,
          description: newProduct.description || undefined,
          priceUsdt: newProduct.priceUsdt,
          category: newProduct.category || 'General',
          imageUrl: newProduct.imageUrl || undefined,
          stock: parseInt(newProduct.stock, 10) || 0,
        }),
      });
      if (res.ok) {
        const created: AdminProduct = await res.json();
        setProducts((prev) => [created, ...prev]);
        setNewProduct(EMPTY_PRODUCT);
        setShowAddForm(false);
      }
    } finally {
      setAddingProduct(false);
    }
  };

  if (unauthorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground text-center px-8">⛔ Доступ только для администраторов.</p>
      </div>
    );
  }

  if (!adminId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground animate-pulse">Загрузка…</p>
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
          <TabsList className="w-full mb-4">
            <TabsTrigger value="orders" className="flex-1">Заказы</TabsTrigger>
            <TabsTrigger value="products" className="flex-1">Товары</TabsTrigger>
            <TabsTrigger value="suggestions" className="flex-1">Идеи</TabsTrigger>
          </TabsList>

          {/* ── ORDERS ── */}
          <TabsContent value="orders">
            <div className="flex justify-end mb-3">
              <Button variant="outline" size="sm" onClick={() => loadOrders(adminId)}>
                🔄 Обновить
              </Button>
            </div>

            {ordersLoading ? (
              <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
            ) : orders.length === 0 ? (
              <p className="text-muted-foreground text-center py-10">Заказов пока нет.</p>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div key={order.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Заказ #{order.id}</span>
                      <Badge variant={STATUS_COLOR[order.status] ?? 'outline'} className="text-xs">
                        {order.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      User #{order.userId} · ${order.totalUsdt} USDT ·{' '}
                      {new Date(order.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                    {order.txHash && (
                      <p className="text-xs font-mono text-muted-foreground truncate">
                        TX: {order.txHash}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <select
                        className="flex-1 text-xs bg-background border rounded px-2 py-1.5 text-foreground"
                        value={pendingStatus[order.id] ?? order.status}
                        onChange={(e) =>
                          setPendingStatus((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs shrink-0"
                        disabled={
                          !pendingStatus[order.id] ||
                          pendingStatus[order.id] === order.status ||
                          updatingOrder === order.id
                        }
                        onClick={() => updateOrderStatus(order.id)}
                      >
                        {updatingOrder === order.id ? '…' : 'Обновить'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── PRODUCTS ── */}
          <TabsContent value="products">
            <div className="flex justify-between mb-3">
              <Button variant="outline" size="sm" onClick={() => loadProducts(adminId)}>
                🔄 Обновить
              </Button>
              <Button size="sm" onClick={() => setShowAddForm((v) => !v)}>
                {showAddForm ? 'Отмена' : '+ Добавить'}
              </Button>
            </div>

            {showAddForm && (
              <div className="border rounded-lg p-3 mb-4 space-y-2">
                <p className="text-sm font-medium">Новый товар</p>
                <Input
                  placeholder="Название *"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Категория"
                  value={newProduct.category}
                  onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Цена USDT *"
                  value={newProduct.priceUsdt}
                  onChange={(e) => setNewProduct((p) => ({ ...p, priceUsdt: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="Количество"
                  type="number"
                  value={newProduct.stock}
                  onChange={(e) => setNewProduct((p) => ({ ...p, stock: e.target.value }))}
                  className="text-sm"
                />
                <Input
                  placeholder="URL изображения"
                  value={newProduct.imageUrl}
                  onChange={(e) => setNewProduct((p) => ({ ...p, imageUrl: e.target.value }))}
                  className="text-sm"
                />
                <Textarea
                  placeholder="Описание"
                  value={newProduct.description}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                  className="text-sm"
                  rows={2}
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={addingProduct || !newProduct.name || !newProduct.priceUsdt}
                  onClick={createProduct}
                >
                  {addingProduct ? 'Сохранение…' : 'Сохранить товар'}
                </Button>
              </div>
            )}

            {productsLoading ? (
              <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
            ) : products.length === 0 ? (
              <p className="text-muted-foreground text-center py-10">Товаров пока нет.</p>
            ) : (
              <div className="space-y-3">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className={`border rounded-lg p-3 space-y-1 transition-opacity ${!product.active ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{product.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        ${product.priceUsdt}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {product.category} · В наличии: {product.stock}
                    </p>
                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        variant={product.active ? 'destructive' : 'outline'}
                        className="text-xs"
                        onClick={() => toggleProduct(product.id, !product.active)}
                      >
                        {product.active ? 'Деактивировать' : 'Активировать'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── SUGGESTIONS ── */}
          <TabsContent value="suggestions">
            <div className="flex justify-end mb-3">
              <Button variant="outline" size="sm" onClick={() => loadSuggestions(adminId)}>
                🔄 Обновить
              </Button>
            </div>

            {suggestionsLoading ? (
              <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
            ) : suggestions.length === 0 ? (
              <p className="text-muted-foreground text-center py-10">Предложений пока нет.</p>
            ) : (
              <div className="space-y-3">
                {suggestions.map((s) => (
                  <div key={s.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{s.productName}</span>
                      <span className="text-xs text-muted-foreground">User #{s.userId}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
