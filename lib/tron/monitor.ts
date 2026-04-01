import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and, lt, isNull, inArray } from 'drizzle-orm';
import { notifyPaymentConfirmed, notifyOrderExpired } from '@/lib/bot/notifications';
import { releaseAddress } from './pool';

const USDT_CONTRACT =
  process.env.TRON_USDT_CONTRACT ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TRONGRID_API =
  process.env.TRONGRID_API_URL ?? 'https://api.trongrid.io';
const CONFIRMATIONS_REQUIRED =
  parseInt(process.env.PAYMENT_CONFIRMATIONS_REQUIRED ?? '1', 10);
const ORDER_TTL_MINUTES =
  parseInt(process.env.ORDER_TTL_MINUTES ?? '30', 10);

interface TronGridTx {
  transaction_id: string;
  to: string;
  value: string;
  confirmed: boolean;
  block_timestamp: number; // milliseconds since epoch
}

/**
 * Polls TronGrid for all TRC20 orders in 'awaiting_payment' status.
 * Also expires stale orders older than ORDER_TTL_MINUTES.
 * Called by the Vercel Cron every minute.
 */
export async function checkPendingPayments(): Promise<void> {
  await expireStaleOrders();

  const pending = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, 'awaiting_payment'), eq(orders.paymentMethod, 'trc20')));

  for (const order of pending) {
    try {
      const res = await fetch(
        `${TRONGRID_API}/v1/accounts/${order.paymentAddress}/transactions/trc20` +
          `?contract_address=${USDT_CONTRACT}&limit=50&only_to=true`,
        {
          headers: {
            'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY ?? '',
          },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!res.ok) {
        console.error(`[tron-monitor] TronGrid error for order ${order.id}: ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { data?: TronGridTx[] };
      const txs = json.data ?? [];

      // USDT has 6 decimals — order.totalUsdt stored as e.g. "10.500000"
      const requiredMicro = BigInt(
        Math.round(parseFloat(order.totalUsdt) * 1_000_000)
      );

      // Only consider transactions that arrived AFTER this order was created.
      // This prevents a recycled deposit address from matching a previous
      // tenant's payment TX (C1 false-confirmation bug).
      const orderCreatedMs = order.createdAt ? new Date(order.createdAt).getTime() : 0;

      const match = txs.find(
        (tx) =>
          tx.to === order.paymentAddress &&
          BigInt(tx.value) >= requiredMicro &&
          tx.block_timestamp >= orderCreatedMs &&
          (CONFIRMATIONS_REQUIRED <= 1 || tx.confirmed)
      );

      if (match) {
        // Idempotency guard: only update if txHash is not yet set
        const updated = await db
          .update(orders)
          .set({ status: 'paid', txHash: match.transaction_id, paidAt: new Date() })
          .where(and(eq(orders.id, order.id), isNull(orders.txHash)))
          .returning({ id: orders.id });

        if (updated.length > 0) {
          // Return the address to the pool for reuse
          await releaseAddress(order.paymentAddress).catch((err) =>
            console.error(`[tron-monitor] Failed to release address for order ${order.id}:`, err)
          );
          if (order.userId) {
            await notifyPaymentConfirmed(order.userId, order.id, match.transaction_id, 'trc20');
          }
        }
      }
    } catch (err) {
      console.error(`[tron-monitor] Failed to check order ${order.id}:`, err);
    }
  }
}

async function expireStaleOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - ORDER_TTL_MINUTES * 60 * 1000);

  const stale = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, 'awaiting_payment'),
        eq(orders.paymentMethod, 'trc20'),
        lt(orders.createdAt, cutoff)
      )
    );

  const staleIds = stale.map((o) => o.id);
  if (staleIds.length > 0) {
    await db.update(orders).set({ status: 'cancelled' }).where(inArray(orders.id, staleIds));
  }

  for (const order of stale) {
    // Return TRC20 address to the pool so it can be reused
    await releaseAddress(order.paymentAddress).catch((err) =>
      console.error(`[tron-monitor] Failed to release address for expired order ${order.id}:`, err)
    );

    if (order.userId) {
      await notifyOrderExpired(order.userId, order.id);
    }
  }
}
