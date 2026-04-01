import { db } from '@/lib/db';
import { orders, orderItems, products } from '@/lib/db/schema';
import { eq, and, lt, isNull, inArray, sql } from 'drizzle-orm';
import { notifyPaymentConfirmed, notifyOrderExpired } from '@/lib/bot/notifications';
import { invalidateProductsCache } from '@/lib/products-cache';
import { orderComment } from './price';

const TON_WALLET = process.env.TON_WALLET_ADDRESS;
const TONCENTER_BASE = process.env.TONCENTER_API_URL ?? 'https://toncenter.com/api/v2';
const ORDER_TTL_MINUTES = parseInt(process.env.ORDER_TTL_MINUTES ?? '60', 10);
// Allow up to 1% underpayment to handle minor price drift
const TOLERANCE_BPS = BigInt(99); // 99/100
const TOLERANCE_DIVISOR = BigInt(100);

interface TonCenterTx {
  transaction_id: { hash: string };
  utime: number; // Unix timestamp in seconds
  in_msg: {
    value?: string;   // nanotons as string
    message?: string; // decoded text comment
  };
}

/**
 * Fetches the last 50 incoming transactions to our TON wallet and matches
 * them against all orders in 'awaiting_payment' status by comment.
 * Called by the Vercel Cron every minute.
 */
export async function checkPendingPayments(): Promise<void> {
  if (!TON_WALLET) {
    console.error('[ton-monitor] TON_WALLET_ADDRESS is not set — skipping TON payment check');
    return;
  }

  await expireStaleOrders();

  // Also check 'pending' orders — user may have sent crypto but closed the app
  // before clicking "I sent payment", so the PATCH to awaiting_payment never fired.
  const pending = await db
    .select()
    .from(orders)
    .where(and(
      inArray(orders.status, ['awaiting_payment', 'pending']),
      eq(orders.paymentMethod, 'ton'),
    ));

  if (pending.length === 0) return;

  // One API call fetches recent txs for all pending orders
  const url = new URL(`${TONCENTER_BASE}/getTransactions`);
  url.searchParams.set('address', TON_WALLET!);
  url.searchParams.set('limit', '100');
  url.searchParams.set('archival', 'false');

  const headers: Record<string, string> = {};
  const apiKey = process.env.TONCENTER_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;

  let txs: TonCenterTx[];
  try {
    const res = await fetch(url.toString(), {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('[ton-monitor] TonCenter error:', res.status);
      return;
    }
    const json = (await res.json()) as { ok: boolean; result: TonCenterTx[] };
    if (!json.ok) return;
    txs = json.result;
  } catch (err) {
    console.error('[ton-monitor] Failed to fetch transactions:', err);
    return;
  }

  for (const order of pending) {
    if (!order.paymentAmountTon) continue;

    const expectedComment = orderComment(order.id);
    // Parse TON amount string directly to avoid IEEE-754 float drift
    const [tonWhole, tonFrac = ''] = order.paymentAmountTon.split('.');
    const tonFracPadded = tonFrac.padEnd(9, '0').slice(0, 9);
    const expectedNano = BigInt(tonWhole) * BigInt(1_000_000_000) + BigInt(tonFracPadded);

    // Only consider transactions that arrived AFTER this order was created,
    // preventing old replay attacks on the shared TON wallet address.
    if (!order.createdAt) continue;
    const orderCreatedSec = Math.floor(new Date(order.createdAt).getTime() / 1000);

    const match = txs.find((tx) => {
      const comment = tx.in_msg.message ?? '';
      const value = BigInt(tx.in_msg.value ?? '0');
      // comment must match exactly; value must be within tolerance; tx must post-date order
      return (
        comment === expectedComment &&
        value >= (expectedNano * TOLERANCE_BPS) / TOLERANCE_DIVISOR &&
        tx.utime >= orderCreatedSec
      );
    });

    if (!match) continue;

    try {
      // Idempotency guard: only update if txHash is not yet set
      const updated = await db
        .update(orders)
        .set({ status: 'paid', txHash: match.transaction_id.hash, paidAt: new Date() })
        .where(and(eq(orders.id, order.id), isNull(orders.txHash)))
        .returning({ id: orders.id });

      if (updated.length > 0 && order.userId) {
        await notifyPaymentConfirmed(order.userId, order.id, match.transaction_id.hash, 'ton');
      }
    } catch (err) {
      console.error(`[ton-monitor] Failed to confirm order ${order.id}:`, err);
    }
  }
}

async function expireStaleOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - ORDER_TTL_MINUTES * 60 * 1000);

  const stale = await db
    .select({ id: orders.id, userId: orders.userId })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ['awaiting_payment', 'pending']),
        eq(orders.paymentMethod, 'ton'),
        lt(orders.createdAt, cutoff)
      )
    );

  const staleIds = stale.map((o) => o.id);
  if (staleIds.length > 0) {
    await db.update(orders).set({ status: 'cancelled' }).where(inArray(orders.id, staleIds));

    // Restore stock for all items in cancelled orders
    await restoreStock(staleIds);
    await invalidateProductsCache().catch(() => {});
  }

  await Promise.allSettled(
    stale
      .filter((o) => o.userId !== null)
      .map((order) => notifyOrderExpired(order.userId!, order.id))
  );
}

/** Restore product stock for cancelled order items. */
async function restoreStock(cancelledOrderIds: number[]): Promise<void> {
  const items = await db
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(inArray(orderItems.orderId, cancelledOrderIds));

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
          console.error(`[ton-monitor] Failed to restore stock for product ${productId}:`, err)
        )
    )
  );
}
