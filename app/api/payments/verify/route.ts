import { checkPendingPayments } from '@/lib/tron/monitor';
import { NextRequest, NextResponse } from 'next/server';

// Called by Vercel Cron every minute — protected by CRON_SECRET
export async function GET(req: NextRequest): Promise<Response> {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await checkPendingPayments();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cron /api/payments/verify]', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
