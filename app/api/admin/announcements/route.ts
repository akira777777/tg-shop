import { db } from '@/lib/db';
import { announcements } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdmin } from '@/lib/admin-auth';
import {
  BroadcastNotConfiguredError,
  isBroadcastConfigured,
  postAnnouncement,
} from '@/lib/bot/broadcast';

const CreateAnnouncementSchema = z.object({
  text: z.string().trim().min(1, 'Текст не может быть пустым').max(4000, 'Максимум 4000 символов'),
});

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(100);
    return NextResponse.json({
      broadcastConfigured: isBroadcastConfigured(),
      announcements: rows,
    });
  } catch (err) {
    console.error('[GET /api/admin/announcements]', err);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = verifyAdmin(req.headers.get('x-telegram-init-data') ?? '');
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  if (!isBroadcastConfigured()) {
    return NextResponse.json(
      { error: 'BROADCAST_CHANNEL_ID is not configured' },
      { status: 503 },
    );
  }

  const { text } = parsed.data;

  // Insert first as a draft so even delivery failure leaves a record for retry/debug.
  const [row] = await db
    .insert(announcements)
    .values({ text, createdByAdminId: admin.id, source: 'admin_panel' })
    .returning();

  try {
    const messageId = await postAnnouncement(text);
    const [updated] = await db
      .update(announcements)
      .set({ channelMessageId: messageId, sentAt: new Date(), errorMessage: null })
      .where(eq(announcements.id, row.id))
      .returning();
    return NextResponse.json(updated, { status: 201 });
  } catch (err) {
    const msg = err instanceof BroadcastNotConfiguredError
      ? 'Канал не настроен'
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    console.error('[POST /api/admin/announcements]', err);
    const [failed] = await db
      .update(announcements)
      .set({ errorMessage: msg.slice(0, 500) })
      .where(eq(announcements.id, row.id))
      .returning();
    return NextResponse.json({ error: msg, announcement: failed }, { status: 502 });
  }
}
