import { checkPendingPayments as checkTronPayments } from '@/lib/tron/monitor';
import { checkPendingPayments as checkTonPayments } from '@/lib/ton/monitor';
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

  const results = await Promise.allSettled([checkTronPayments(), checkTonPayments()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[cron /api/payments/verify] Monitor threw:', result.reason);
    }
  }
  return NextResponse.json({ ok: true });
}
