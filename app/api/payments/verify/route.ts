import { checkPendingPayments as checkTronPayments } from '@/lib/tron/monitor';
import { ensureWebhook } from '@/lib/bot/ensure-webhook';
import { redis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

const CRON_LOCK_KEY = 'cron:payments:lock';
// TTL shorter than the QStash minute interval so a crashed invocation
// eventually releases the lock automatically.
const CRON_LOCK_TTL_S = 55;

// Called by Upstash QStash every minute — protected by CRON_SECRET
export async function POST(req: NextRequest): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${cronSecret}`;

  // Use timing-safe comparison to prevent timing-oracle attacks
  const isAuthorized =
    authHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Prevent concurrent runs: if the previous invocation is still working, skip.
  // This avoids duplicate TronGrid hits and race conditions on the same order.
  const lockAcquired = await redis.set(CRON_LOCK_KEY, '1', {
    nx: true,
    ex: CRON_LOCK_TTL_S,
  });
  if (!lockAcquired) {
    console.log('[cron] skipped: previous run still in progress');
    return NextResponse.json({ ok: true, skipped: 'locked' });
  }

  try {
    // Run TRC20 monitor + webhook self-heal in parallel
    const results = await Promise.allSettled([checkTronPayments(), ensureWebhook()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[cron /api/payments/verify] Task threw:', result.reason);
      }
    }
  } finally {
    // Release early so the next tick (≥55s later) always has a clean slate.
    await redis.del(CRON_LOCK_KEY).catch((err) =>
      console.error('[cron] lock release failed:', err),
    );
  }

  return NextResponse.json({ ok: true });
}
