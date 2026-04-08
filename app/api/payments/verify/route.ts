import { checkPendingPayments as checkTronPayments } from '@/lib/tron/monitor';
import { ensureWebhook } from '@/lib/bot/ensure-webhook';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

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

  // Run TRC20 monitor + webhook self-heal in parallel
  const results = await Promise.allSettled([checkTronPayments(), ensureWebhook()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[cron /api/payments/verify] Task threw:', result.reason);
    }
  }
  return NextResponse.json({ ok: true });
}
