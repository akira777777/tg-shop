import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { desc, lt, eq, and } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

const PAGE_SIZE = 50;

/**
 * GET /api/admin/orders
 * Query params:
 *   cursor  — order ID to paginate from (exclusive, returns orders with id < cursor)
 *   status  — filter by status (optional)
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursorParam = searchParams.get('cursor');
  const statusParam = searchParams.get('status');

  const cursorId = cursorParam ? parseInt(cursorParam, 10) : null;
  if (cursorParam && (isNaN(cursorId!) || cursorId! <= 0)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  }

  try {
    // drizzle and() ignores undefined args — safe to pass unconditionally
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          cursorId != null ? lt(orders.id, cursorId) : undefined,
          statusParam ? eq(orders.status, statusParam) : undefined,
        ),
      )
      .orderBy(desc(orders.id))
      .limit(PAGE_SIZE + 1); // fetch one extra to detect if there's a next page

    const hasMore = rows.length > PAGE_SIZE;
    const data = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return NextResponse.json({ data, nextCursor });
  } catch (err) {
    console.error('[GET /api/admin/orders]', err);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}
