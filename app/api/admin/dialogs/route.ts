import { db } from '@/lib/db';
import { messages, users } from '@/lib/db/schema';
import { sql, eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

/**
 * GET /api/admin/dialogs
 * Returns distinct user dialogs with counts, last-message preview and time.
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await db
      .select({
        userId: messages.userId,
        username: users.username,
        firstName: users.firstName,
        lastMessage: sql<string>`(
          SELECT content FROM ${messages} m2
          WHERE m2.user_id = ${messages.userId}
          ORDER BY m2.created_at DESC LIMIT 1
        )`,
        lastDirection: sql<string>`(
          SELECT direction FROM ${messages} m2
          WHERE m2.user_id = ${messages.userId}
          ORDER BY m2.created_at DESC LIMIT 1
        )`,
        lastAt: sql<Date>`MAX(${messages.createdAt})`,
        totalCount: sql<number>`COUNT(*)::int`,
        userCount: sql<number>`SUM(CASE WHEN ${messages.direction} = 'user_to_admin' THEN 1 ELSE 0 END)::int`,
      })
      .from(messages)
      .leftJoin(users, eq(users.telegramId, messages.userId))
      .groupBy(messages.userId, users.username, users.firstName)
      .orderBy(desc(sql`MAX(${messages.createdAt})`))
      .limit(100);

    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[GET /api/admin/dialogs]', err);
    return NextResponse.json({ error: 'Failed to load dialogs' }, { status: 500 });
  }
}
