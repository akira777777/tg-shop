import { db } from '@/lib/db';
import { messages, users } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { tgSend } from '@/lib/bot/telegram-api';
import { getUserLocale, tr } from '@/lib/bot/user-lang';

/** GET /api/admin/dialogs/:userId — full conversation history */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId: userIdStr } = await params;
  const userId = parseInt(userIdStr, 10);
  if (isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, userId))
      .limit(1);

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(asc(messages.createdAt))
      .limit(500);

    return NextResponse.json({ user: user ?? null, messages: history });
  } catch (err) {
    console.error('[GET /api/admin/dialogs/:userId]', err);
    return NextResponse.json({ error: 'Failed to load dialog' }, { status: 500 });
  }
}

/** POST /api/admin/dialogs/:userId — send anonymous admin reply to user */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const admin = verifyAdmin(req.headers.get('x-telegram-init-data') ?? '');
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId: userIdStr } = await params;
  const userId = parseInt(userIdStr, 10);
  if (isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content || content.length > 4000) {
    return NextResponse.json({ error: 'Content required (≤4000 chars)' }, { status: 400 });
  }

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  try {
    const locale = await getUserLocale(userId);
    await tgSend(userId, `${tr('reply.prefix', locale)}\n\n${escape(content)}`);
    await db
      .insert(messages)
      .values({ userId, direction: 'admin_to_user', content })
      .catch((err) => console.error('[admin dialog] DB insert failed:', err));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/admin/dialogs/:userId]', err);
    return NextResponse.json(
      { error: `Failed to deliver: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 },
    );
  }
}
