import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and, lt, isNull, inArray } from 'drizzle-orm';
import { notifyPaymentConfirmed, notifyOrderExpired } from '@/lib/bot/notifications';
import { invalidateProductsCache } from '@/lib/products-cache';
import { restoreStock } from '@/lib/restore-stock';
import { orderComment } from './price';
import { sendExpiryWarnings } from '@/lib/monitor-utils';

const TON_WALLET = process.env.TON_WALLET_ADDRESS;
const TONCENTER_BASE = process.env.TONCENTER_API_URL ?? 'https://toncenter.com/api/v2';
// Default 60 min for TON (shared wallet, no address scarcity)
const ORDER_TTL_MINUTES = parseInt(
  process.env.TON_ORDER_TTL_MINUTES ?? process.env.ORDER_TTL_MINUTES ?? '60',
  10,
);
// Allow up to 1% underpayment to handle minor price drift
const TOLERANCE_BPS = BigInt(99); // 99/100
const TOLERANCE_DIVISOR = BigInt(100);
// Max transactions to fetch per page from TonCenter
const TX_PAGE_SIZE = 100;
// Maximum pages to scan (safety cap: 10 pages × 100 = 1000 txs per cron run)
const MAX_PAGES = 10;

interface TonCenterTx {
  transaction_id: { hash: string; lt: string };
  utime: number; // Unix timestamp in seconds
  in_msg: {
    value?: string;   // nanotons as string
    message?: string; // decoded text comment
  };
}

/**
 * Fetches incoming transactions to our TON wallet (paginated) and matches
 * them against all orders in 'awaiting_payment' or 'pending' status by comment.
 * Stops paginating when all pending orders are matched or the oldest tx pre-dates
 * all pending orders.
 * Called by QStash every minute.
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

  // Pre-expiry warnings (>70% of TTL elapsed, still unpaid)
  await sendExpiryWarnings(pending, ORDER_TTL_MINUTES);

  const headers: Record<string, string> = {};
  const apiKey = process.env.TONCENTER_API_KEY;
  if (apiKey) headers['X-API-Key'] = apiKey;

  // Track which orders are still unmatched — stop paginating when all matched
  const unmatchedOrderIds = new Set(pending.map((o) => o.id));

  // Oldest order creation time in seconds — no point scanning txs older than this
  const oldestOrderSec = Math.min(
    ...pending
      .filter((o) => o.createdAt != null)
      .map((o) => Math.floor(new Date(o.createdAt!).getTime() / 1000)),
  );

  let lastLt: string | undefined;
  let lastHash: string | undefined;

  for (let page = 0; page < MAX_PAGES && unmatchedOrderIds.size > 0; page++) {
    const url = new URL(`${TONCENTER_BASE}/getTransactions`);
    url.searchParams.set('address', TON_WALLET!);
    url.searchParams.set('limit', String(TX_PAGE_SIZE));
    url.searchParams.set('archival', 'false');
    if (lastLt && lastHash) {
      // Cursor pagination: fetch txs older than the last seen tx
      url.searchParams.set('lt', lastLt);
      url.searchParams.set('hash', lastHash);
    }

    let txs: TonCenterTx[];
    try {
      const res = await fetch(url.toString(), {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error('[ton-monitor] TonCenter error:', res.status);
        break;
      }
      const json = (await res.json()) as { ok: boolean; result: TonCenterTx[] };
      if (!json.ok || json.result.length === 0) break;
      txs = json.result;
    } catch (err) {
      console.error('[ton-monitor] Failed to fetch transactions (page', page, '):', err);
      break;
    }

    // Process this page
    for (const order of pending) {
      if (!unmatchedOrderIds.has(order.id)) continue;
      if (!order.paymentAmountTon || !order.createdAt) continue;

      const expectedComment = orderComment(order.id);
      // Parse TON amount string directly to avoid IEEE-754 float drift
      const [tonWhole, tonFrac = ''] = order.paymentAmountTon.split('.');
      const tonFracPadded = tonFrac.padEnd(9, '0').slice(0, 9);
      const expectedNano = BigInt(tonWhole) * BigInt(1_000_000_000) + BigInt(tonFracPadded);
      const orderCreatedSec = Math.floor(new Date(order.createdAt).getTime() / 1000);

      const match = txs.find((tx) => {
        const comment = tx.in_msg.message ?? '';
        const value = BigInt(tx.in_msg.value ?? '0');
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
        unmatchedOrderIds.delete(order.id);
      } catch (err) {
        console.error(`[ton-monitor] Failed to confirm order ${order.id}:`, err);
      }
    }

    // Stop if the oldest tx on this page pre-dates all pending orders
    const oldestTxOnPage = txs[txs.length - 1];
    if (!oldestTxOnPage || oldestTxOnPage.utime < oldestOrderSec) break;

    // Advance cursor for next page
    lastLt = oldestTxOnPage.transaction_id.lt;
    lastHash = oldestTxOnPage.transaction_id.hash;
    if (txs.length < TX_PAGE_SIZE) break; // last page
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
    await restoreStock(staleIds, 'ton-monitor');
    await invalidateProductsCache().catch(() => {});
  }

  await Promise.allSettled(
    stale
      .filter((o) => o.userId !== null)
      .map((order) => notifyOrderExpired(order.userId!, order.id))
  );
}
