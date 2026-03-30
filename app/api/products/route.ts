import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(): Promise<Response> {
  try {
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.active, true));
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /api/products]', err);
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  }
}
