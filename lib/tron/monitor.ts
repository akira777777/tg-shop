import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and, lt } from 'drizzle-orm';
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
 * Polls TronGrid for all orders in 'awaiting_payment' status.
 * Also expires stale orders older than ORDER_TTL_MINUTES.
 * Called by the Vercel Cron every minute.
 */
export async function checkPendingPayments(): Promise<void> {
  await expireStaleOrders();

  const pending = await db
    .select()
    .from(orders)
    .where(eq(orders.status, 'awaiting_payment'));

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

      // Require the configured number of confirmations
      const match = txs.find(
        (tx) =>
          tx.to === order.paymentAddress &&
          BigInt(tx.value) >= requiredMicro &&
          (CONFIRMATIONS_REQUIRED <= 1 || tx.confirmed)
      );

      if (match) {
        await db
          .update(orders)
          .set({ status: 'paid', txHash: match.transaction_id, paidAt: new Date() })
          .where(eq(orders.id, order.id));

        // Return address to the pool after payment
        await releaseAddress(order.paymentAddress);

        if (order.userId) {
          await notifyPaymentConfirmed(order.userId, order.id, match.transaction_id);
        }
      }
    } catch {
      console.error(`[monitor] Failed to check order ${order.id}`);
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
        lt(orders.createdAt, cutoff)
      )
    );

  for (const order of stale) {
    await db
      .update(orders)
      .set({ status: 'cancelled' })
      .where(eq(orders.id, order.id));

    await releaseAddress(order.paymentAddress);
  }
}
