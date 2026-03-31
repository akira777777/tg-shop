import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getCachedProducts, setCachedProducts } from '@/lib/products-cache';

export async function GET(): Promise<Response> {
  try {
    const cached = await getCachedProducts();
    if (cached) return NextResponse.json(cached);

    const rows = await db
      .select()
      .from(products)
      .where(eq(products.active, true));

    await setCachedProducts(rows).catch((err) =>
      console.error('[products] Cache write failed:', err)
    );

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /api/products]', err);
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  }
}
