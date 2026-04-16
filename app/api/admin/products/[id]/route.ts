import { db } from '@/lib/db';
import { orderItems, products } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import { invalidateProductsCache } from '@/lib/products-cache';
import { markProductRemoved } from '@/lib/bot/broadcast';

const UpdateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  priceUsdt: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Некорректный формат цены USDT').optional(),
  category: z.string().min(1).max(100).optional(),
  // Only allow https:// URLs to prevent javascript: or data: injection
  imageUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'URL must use HTTPS' })
    .optional()
    .nullable(),
  stock: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const productId = parseInt(id, 10);
  if (isNaN(productId)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { imageUrl, ...rest } = parsed.data;
  const updates = {
    ...rest,
    // Convert imageUrl: empty string → null (clearing the image)
    ...(imageUrl !== undefined ? { imageUrl: imageUrl || null } : {}),
  };

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const [before] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!before) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const [updated] = await db
      .update(products)
      .set(updates)
      .where(eq(products.id, productId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    await invalidateProductsCache().catch(() => {});

    // If the product is currently posted in the channel and transitions to
    // "unavailable" (inactive or out of stock), edit the post to mark it removed.
    // Non-fatal: any broadcast error is logged but doesn't fail the update.
    const becameUnavailable =
      updated.channelMessageId != null &&
      ((before.active && !updated.active) || (before.stock > 0 && updated.stock === 0));
    if (becameUnavailable && updated.channelMessageId != null) {
      await markProductRemoved(updated.channelMessageId, {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        priceUsdt: updated.priceUsdt,
      }).catch((err) =>
        console.error(`[PATCH /api/admin/products/${productId}] channel edit failed:`, err),
      );
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[PATCH /api/admin/products/:id]', err);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const productId = parseInt(id, 10);
  if (isNaN(productId)) {
    return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
  }

  try {
    // Check if any orders reference this product — if so, soft-delete only
    const [{ referencedCount }] = await db
      .select({ referencedCount: count() })
      .from(orderItems)
      .where(eq(orderItems.productId, productId));

    if (referencedCount > 0) {
      // Soft delete: mark inactive so it disappears from catalog but order history stays intact
      const [updated] = await db
        .update(products)
        .set({ active: false })
        .where(eq(products.id, productId))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }
      await invalidateProductsCache().catch(() => {});
      if (updated.channelMessageId != null) {
        await markProductRemoved(updated.channelMessageId, {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          priceUsdt: updated.priceUsdt,
        }).catch((err) =>
          console.error(`[DELETE /api/admin/products/${productId}] channel edit failed:`, err),
        );
      }
      return NextResponse.json({ deleted: false, deactivated: true });
    }

    // Hard delete — safe since no orders reference this product
    const [deleted] = await db
      .delete(products)
      .where(eq(products.id, productId))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    await invalidateProductsCache().catch(() => {});
    if (deleted.channelMessageId != null) {
      await markProductRemoved(deleted.channelMessageId, {
        id: deleted.id,
        name: deleted.name,
        description: deleted.description,
        priceUsdt: deleted.priceUsdt,
      }).catch((err) =>
        console.error(`[DELETE /api/admin/products/${productId}] channel edit failed:`, err),
      );
    }
    return NextResponse.json({ deleted: true, deactivated: false });
  } catch (err) {
    console.error('[DELETE /api/admin/products/:id]', err);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}
