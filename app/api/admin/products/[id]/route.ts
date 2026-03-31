import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { invalidateProductsCache } from '@/lib/products-cache';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const productId = parseInt(id, 10);
  if (isNaN(productId)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  let body: {
    adminId?: number;
    stock?: number;
    active?: boolean;
    name?: string;
    description?: string;
    priceUsdt?: string;
    category?: string;
    imageUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.adminId || !isAdmin(body.adminId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const updates: Partial<{
    stock: number;
    active: boolean;
    name: string;
    description: string;
    priceUsdt: string;
    category: string;
    imageUrl: string;
  }> = {};
  if (typeof body.stock === 'number') updates.stock = body.stock;
  if (typeof body.active === 'boolean') updates.active = body.active;
  if (typeof body.name === 'string' && body.name) updates.name = body.name;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.priceUsdt === 'string' && body.priceUsdt) updates.priceUsdt = body.priceUsdt;
  if (typeof body.category === 'string' && body.category) updates.category = body.category;
  if (typeof body.imageUrl === 'string') updates.imageUrl = body.imageUrl || undefined;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(products)
      .set(updates)
      .where(eq(products.id, productId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    await invalidateProductsCache().catch(() => {});
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[PATCH /api/admin/products/:id]', err);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}
