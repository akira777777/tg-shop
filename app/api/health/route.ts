import { NextResponse } from 'next/server';

/**
 * GET /api/health — lightweight liveness check.
 * Returns 200 with a timestamp. Used by QStash keep-alive pings to keep the
 * Vercel serverless function warm so the Telegram webhook responds quickly.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
