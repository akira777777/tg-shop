import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import {
  BroadcastNotConfiguredError,
  isBroadcastConfigured,
  markProductRemoved,
  postProduct,
} from '@/lib/bot/broadcast';

async function loadProduct(productId: number) {
  const [row] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  return row ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isBroadcastConfigured()) {
    return NextResponse.json(
      { error: 'BROADCAST_CHANNEL_ID is not configured' },
      { status: 503 },
    );
  }

  const { id: idStr } = await params;
  const productId = parseInt(idStr, 10);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const product = await loadProduct(productId);
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (product.channelMessageId != null) {
    return NextResponse.json(
      { error: 'Товар уже опубликован в канале', channelMessageId: product.channelMessageId },
      { status: 409 },
    );
  }

  try {
    const messageId = await postProduct({
      id: product.id,
      name: product.name,
      description: product.description,
      priceUsdt: product.priceUsdt,
    });
    const [updated] = await db
      .update(products)
      .set({ channelMessageId: messageId, channelPostedAt: new Date() })
      .where(eq(products.id, productId))
      .returning();
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof BroadcastNotConfiguredError
      ? 'Канал не настроен'
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    console.error(`[POST /api/admin/products/${productId}/publish]`, err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isBroadcastConfigured()) {
    return NextResponse.json(
      { error: 'BROADCAST_CHANNEL_ID is not configured' },
      { status: 503 },
    );
  }

  const { id: idStr } = await params;
  const productId = parseInt(idStr, 10);
  if (!Number.isFinite(productId)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  const product = await loadProduct(productId);
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (product.channelMessageId == null) {
    return NextResponse.json(
      { error: 'Товар не был опубликован' },
      { status: 409 },
    );
  }

  try {
    await markProductRemoved(product.channelMessageId, {
      id: product.id,
      name: product.name,
      description: product.description,
      priceUsdt: product.priceUsdt,
    });
  } catch (err) {
    // Non-fatal: clear the tracking field anyway so admin can re-publish a new post.
    console.error(`[DELETE /api/admin/products/${productId}/publish] edit failed:`, err);
  }

  const [updated] = await db
    .update(products)
    .set({ channelMessageId: null, channelPostedAt: null })
    .where(eq(products.id, productId))
    .returning();
  return NextResponse.json(updated);
}
