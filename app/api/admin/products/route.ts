import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import { invalidateProductsCache } from '@/lib/products-cache';

const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priceUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Некорректный формат цены USDT'),
  category: z.string().min(1).max(100).default('General'),
  imageUrl: z.string().optional(),
  stock: z.number().int().min(0).default(0),
});

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Include inactive products — admin sees everything
    const rows = await db.select().from(products).orderBy(desc(products.id));
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /api/admin/products]', err);
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { name, description, priceUsdt, category, imageUrl, stock } = parsed.data;

  try {
    const [created] = await db
      .insert(products)
      .values({ name, description: description ?? null, priceUsdt, category, imageUrl: imageUrl ?? null, stock })
      .returning();
    await invalidateProductsCache().catch(() => {});
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/products]', err);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
