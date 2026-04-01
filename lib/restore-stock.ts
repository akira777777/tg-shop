import { db } from '@/lib/db';
import { orderItems, products } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

/** Restore product stock for cancelled order items. */
export async function restoreStock(cancelledOrderIds: number[], logPrefix: string): Promise<void> {
  const items = await db
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.orderId, cancelledOrderIds));

  // Aggregate quantities per product in case multiple cancelled orders share a product
  const qtyByProduct = new Map<number, number>();
  for (const item of items) {
    if (item.productId == null) continue;
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  await Promise.allSettled(
    [...qtyByProduct.entries()].map(([productId, qty]) =>
      db
        .update(products)
        .set({ stock: sql`${products.stock} + ${qty}` })
        .where(eq(products.id, productId))
        .catch((err) =>
          console.error(`[${logPrefix}] Failed to restore stock for product ${productId}:`, err)
        )
    )
  );
}
