import { NextRequest, NextResponse } from 'next/server';
import { verifyInitData } from '@/lib/telegram-auth';
import { setUserLocale } from '@/lib/bot/user-lang';

/**
 * POST /api/user/lang
 * Body: { languageCode: string }
 * Caches the authenticated user's preferred language for bot messages.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { languageCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.languageCode !== 'string' || body.languageCode.length > 10) {
    return NextResponse.json({ error: 'Invalid languageCode' }, { status: 400 });
  }

  await setUserLocale(user.id, body.languageCode);
  return NextResponse.json({ ok: true });
}
