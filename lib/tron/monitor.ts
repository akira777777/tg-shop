import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { notifyPaymentConfirmed } from '@/lib/bot/notifications';
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
          `?contract_address=${USDT_CONTRACT}&limit=10&only_to=true`,
        {
          headers: {
            'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY ?? '',
          },
        }
      );

      if (!res.ok) continue;
      const json = (await res.json()) as { data?: TronGridTx[] };
      const txs = json.data ?? [];

      // USDT has 6 decimals — order.totalUsdt stored as e.g. "10.500000"
      const requiredMicro = BigInt(
        Math.round(parseFloat(order.totalUsdt) * 1_000_000)
      );

      const match = txs.find(
        (tx) =>
          tx.to === order.paymentAddress &&
          BigInt(tx.value) >= requiredMicro &&
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
            await notifyPaymentConfirmed(order.userId, order.id, match.transaction_id);
          }
        }
      }
    } catch {
      console.error(`[tron-monitor] Failed to check order ${order.id}`);
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

  for (const order of stale) {
    await db
      .update(orders)
      .set({ status: 'cancelled' })
      .where(eq(orders.id, order.id));

    // Return TRC20 address to the pool so it can be reused
    await releaseAddress(order.paymentAddress).catch((err) =>
      console.error(`[tron-monitor] Failed to release address for expired order ${order.id}:`, err)
    );
  }
}
