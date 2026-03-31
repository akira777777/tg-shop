import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { notifyPaymentConfirmed } from '@/lib/bot/notifications';
import { orderComment } from './price';

const TON_WALLET = process.env.TON_WALLET_ADDRESS!;
const TONCENTER_BASE = process.env.TONCENTER_API_URL ?? 'https://toncenter.com/api/v2';
const ORDER_TTL_MINUTES = parseInt(process.env.ORDER_TTL_MINUTES ?? '60', 10);
// Allow up to 1% underpayment to handle minor price drift
const TOLERANCE_BPS = 99n; // 99/100

interface TonCenterTx {
  transaction_id: { hash: string };
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
  await expireStaleOrders();

  const pending = await db
    .select()
    .from(orders)
    .where(eq(orders.status, 'awaiting_payment'));

  if (pending.length === 0) return;

  // One API call fetches recent txs for all pending orders
  const url = new URL(`${TONCENTER_BASE}/getTransactions`);
  url.searchParams.set('address', TON_WALLET);
  url.searchParams.set('limit', '50');
  url.searchParams.set('archival', 'false');

  const headers: Record<string, string> = {};
  const apiKey = process.env.TONCENTER_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;

  let txs: TonCenterTx[];
  try {
    const res = await fetch(url.toString(), { headers, cache: 'no-store' });
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
    const expectedNano = BigInt(Math.round(parseFloat(order.paymentAmountTon) * 1_000_000_000));

    const match = txs.find((tx) => {
      const comment = tx.in_msg.message ?? '';
      const value = BigInt(tx.in_msg.value ?? '0');
      // comment must match exactly; value must be within tolerance
      return comment === expectedComment && value >= (expectedNano * TOLERANCE_BPS) / 100n;
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
        await notifyPaymentConfirmed(order.userId, order.id, match.transaction_id.hash);
      }
    } catch (err) {
      console.error(`[ton-monitor] Failed to confirm order ${order.id}:`, err);
    }
  }
}

async function expireStaleOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - ORDER_TTL_MINUTES * 60 * 1000);

  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'awaiting_payment'), lt(orders.createdAt, cutoff)));

  for (const { id } of stale) {
    await db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, id));
  }
}
