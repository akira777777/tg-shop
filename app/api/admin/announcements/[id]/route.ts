import { db } from '@/lib/db';
import { announcements } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { deleteChannelMessage } from '@/lib/bot/broadcast';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.deletedAt) return NextResponse.json({ ok: true, alreadyDeleted: true });

  let channelDeleteError: string | null = null;
  if (row.channelMessageId != null) {
    try {
      await deleteChannelMessage(row.channelMessageId);
    } catch (err) {
      // Non-fatal: bot may lack permission or post may be older than 48h.
      channelDeleteError = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[DELETE /api/admin/announcements/${id}] channel delete failed:`, err);
    }
  }

  const [updated] = await db
    .update(announcements)
    .set({ deletedAt: new Date() })
    .where(eq(announcements.id, id))
    .returning();

  return NextResponse.json({ ok: true, announcement: updated, channelDeleteError });
}
