'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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

const EMPTY_PRODUCT = {
  name: '', description: '', priceUsdt: '', category: 'General', stock: '0', imageUrl: '',
};

interface Props {
  authHeaders: () => Record<string, string>;
  onUnauthorized: () => void;
}

export function AdminProducts({ authHeaders, onUnauthorized }: Props) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT);
  const [addingProduct, setAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/products', { headers: authHeaders() });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка загрузки товаров (HTTP ${res.status})`); return; }
      setProducts(await res.json());
      setLoaded(true);
    } catch {
      setError('Не удалось загрузить товары. Проверьте соединение.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onUnauthorized]);

  if (!loaded && !loading) {
    loadProducts();
  }

  const toggleProduct = async (productId: number, active: boolean) => {
    try {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ active }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка изменения статуса товара (HTTP ${res.status})`); return; }
      setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, active } : p));
    } catch {
      setError('Не удалось изменить статус товара. Проверьте соединение.');
    }
  };

  const deleteProduct = async (productId: number) => {
    if (!confirm('Удалить товар?')) return;
    try {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка удаления товара (HTTP ${res.status})`); return; }
      const result = await res.json();
      if (result.deleted) {
        setProducts((prev) => prev.filter((p) => p.id !== productId));
      } else {
        setProducts((prev) => prev.map((p) => p.id === productId ? { ...p, active: false } : p));
      }
    } catch {
      setError('Не удалось удалить товар. Проверьте соединение.');
    }
  };

  const saveEditProduct = async () => {
    if (!editingProduct) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: editingProduct.name,
          description: editingProduct.description ?? '',
          priceUsdt: editingProduct.priceUsdt,
          category: editingProduct.category,
          imageUrl: editingProduct.imageUrl ?? '',
          stock: editingProduct.stock,
        }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка сохранения товара (HTTP ${res.status})`); return; }
      const updated: AdminProduct = await res.json();
      setProducts((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setEditingProduct(null);
    } catch {
      setError('Не удалось сохранить товар. Проверьте соединение.');
    } finally {
      setSavingEdit(false);
    }
  };

  const createProduct = async () => {
    if (!newProduct.name || !newProduct.priceUsdt) return;
    setAddingProduct(true);
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: newProduct.name,
          description: newProduct.description || undefined,
          priceUsdt: newProduct.priceUsdt,
          category: newProduct.category || 'General',
          imageUrl: newProduct.imageUrl || undefined,
          stock: parseInt(newProduct.stock, 10) || 0,
        }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) { setError(`Ошибка создания товара (HTTP ${res.status})`); return; }
      const created: AdminProduct = await res.json();
      setProducts((prev) => [created, ...prev]);
      setNewProduct(EMPTY_PRODUCT);
      setShowAddForm(false);
    } catch {
      setError('Не удалось создать товар. Проверьте соединение.');
    } finally {
      setAddingProduct(false);
    }
  };

  return (
    <>
      <div className="flex justify-between mb-3">
        <Button variant="outline" size="sm" onClick={() => loadProducts()}>
          🔄 Обновить
        </Button>
        <Button size="sm" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? 'Отмена' : '+ Добавить'}
        </Button>
      </div>

      {showAddForm && (
        <div className="border rounded-lg p-3 mb-4 space-y-2">
          <p className="text-sm font-medium">Новый товар</p>
          <Input placeholder="Название *" value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))} className="text-sm" />
          <Input placeholder="Категория" value={newProduct.category} onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))} className="text-sm" />
          <Input placeholder="Цена USDT *" value={newProduct.priceUsdt} onChange={(e) => setNewProduct((p) => ({ ...p, priceUsdt: e.target.value }))} className="text-sm" />
          <Input placeholder="Количество" type="number" value={newProduct.stock} onChange={(e) => setNewProduct((p) => ({ ...p, stock: e.target.value }))} className="text-sm" />
          <Input placeholder="URL изображения" value={newProduct.imageUrl} onChange={(e) => setNewProduct((p) => ({ ...p, imageUrl: e.target.value }))} className="text-sm" />
          <Textarea placeholder="Описание" value={newProduct.description} onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))} className="text-sm" rows={2} />
          <Button size="sm" className="w-full" disabled={addingProduct || !newProduct.name || !newProduct.priceUsdt} onClick={createProduct}>
            {addingProduct ? 'Сохранение…' : 'Сохранить товар'}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-10 animate-pulse">Загрузка…</p>
      ) : error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : products.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">Товаров пока нет.</p>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <div key={product.id} className={`border rounded-lg p-3 space-y-1 transition-opacity ${!product.active ? 'opacity-50' : ''}`}>
              {editingProduct?.id === product.id ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Редактировать товар</p>
                  <Input placeholder="Название *" value={editingProduct.name} onChange={(e) => setEditingProduct((p) => p ? { ...p, name: e.target.value } : p)} className="text-sm" />
                  <Input placeholder="Категория" value={editingProduct.category} onChange={(e) => setEditingProduct((p) => p ? { ...p, category: e.target.value } : p)} className="text-sm" />
                  <Input placeholder="Цена USDT *" value={editingProduct.priceUsdt} onChange={(e) => setEditingProduct((p) => p ? { ...p, priceUsdt: e.target.value } : p)} className="text-sm" />
                  <Input placeholder="Количество" type="number" value={editingProduct.stock} onChange={(e) => setEditingProduct((p) => p ? { ...p, stock: parseInt(e.target.value, 10) || 0 } : p)} className="text-sm" />
                  <Input placeholder="URL изображения" value={editingProduct.imageUrl ?? ''} onChange={(e) => setEditingProduct((p) => p ? { ...p, imageUrl: e.target.value } : p)} className="text-sm" />
                  <Textarea placeholder="Описание" value={editingProduct.description ?? ''} onChange={(e) => setEditingProduct((p) => p ? { ...p, description: e.target.value } : p)} className="text-sm" rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={savingEdit} onClick={saveEditProduct}>
                      {savingEdit ? 'Сохранение…' : 'Сохранить'}
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingProduct(null)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{product.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">${parseFloat(product.priceUsdt).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{product.category} · В наличии: {product.stock}</p>
                  <div className="flex gap-2 justify-end pt-1 flex-wrap">
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setEditingProduct(product)}>Редактировать</Button>
                    <Button size="sm" variant={product.active ? 'destructive' : 'outline'} className="text-xs" onClick={() => toggleProduct(product.id, !product.active)}>
                      {product.active ? 'Деактивировать' : 'Активировать'}
                    </Button>
                    <Button size="sm" variant="destructive" className="text-xs" onClick={() => deleteProduct(product.id)}>Удалить</Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
