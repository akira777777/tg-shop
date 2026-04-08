import { db } from '@/lib/db';
import { users, orders } from '@/lib/db/schema';
import { sql, eq, desc, ilike, or } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

const PAGE_SIZE = 50;

/**
 * GET /api/admin/users?search=&cursor=
 * Returns users with aggregated order count and total spent (paid+ only).
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search')?.trim() ?? '';
  const cursorParam = searchParams.get('cursor');
  const cursorId = cursorParam ? parseInt(cursorParam, 10) : null;
  if (cursorParam && (isNaN(cursorId!) || cursorId! <= 0)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  }

  try {
    const paidStatuses = ['paid', 'processing', 'shipped', 'delivered'];

    // Build filter
    const filters = [];
    if (search) {
      // Match username, firstName, or exact telegramId
      const numeric = parseInt(search, 10);
      const conditions = [
        ilike(users.username, `%${search}%`),
        ilike(users.firstName, `%${search}%`),
      ];
      if (!isNaN(numeric)) conditions.push(eq(users.telegramId, numeric));
      filters.push(or(...conditions));
    }
    if (cursorId != null) {
      filters.push(sql`${users.telegramId} < ${cursorId}`);
    }

    const rows = await db
      .select({
        telegramId: users.telegramId,
        username: users.username,
        firstName: users.firstName,
        createdAt: users.createdAt,
        orderCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${orders}
          WHERE ${orders.userId} = ${users.telegramId}
        )`,
        totalSpent: sql<string>`(
          SELECT COALESCE(SUM(${orders.totalUsdt}), 0)::text FROM ${orders}
          WHERE ${orders.userId} = ${users.telegramId}
            AND ${orders.status} = ANY(${paidStatuses})
        )`,
        lastOrderAt: sql<Date | null>`(
          SELECT MAX(${orders.createdAt}) FROM ${orders}
          WHERE ${orders.userId} = ${users.telegramId}
        )`,
      })
      .from(users)
      .where(filters.length > 0 ? sql`${sql.join(filters, sql` AND `)}` : undefined)
      .orderBy(desc(users.telegramId))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const data = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const nextCursor = hasMore ? data[data.length - 1].telegramId : null;

    return NextResponse.json({ data, nextCursor });
  } catch (err) {
    console.error('[GET /api/admin/users]', err);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}
