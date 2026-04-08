import { db } from '@/lib/db';
import { orders, orderItems, users, products, messages, suggestions } from '@/lib/db/schema';
import { sql, and, gte, inArray, eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { redis } from '@/lib/redis';

const STATS_CACHE_KEY = 'admin:stats';
const STATS_CACHE_TTL = 30; // seconds

/**
 * GET /api/admin/stats
 * Returns aggregate counters and revenue for the admin dashboard.
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Short Redis cache — admin dashboard polls frequently, real-time isn't required
    const cached = await redis.get<string>(STATS_CACHE_KEY).catch(() => null);
    if (cached) {
      return new NextResponse(typeof cached === 'string' ? cached : JSON.stringify(cached), {
        headers: { 'content-type': 'application/json', 'x-cache': 'HIT' },
      });
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const paidStatuses = ['paid', 'processing', 'shipped', 'delivered'];

    // Run every independent query in parallel — was 5 sequential round-trips
    const [
      statusRows,
      revenueRows,
      revenue7Rows,
      revenue30Rows,
      ordersTodayRows,
      usersRows,
      productsRows,
      activeProductsRows,
      lowStockRows,
      messagesRows,
      suggestionsRows,
      topProducts,
    ] = await Promise.all([
      db
        .select({ status: orders.status, count: sql<number>`count(*)::int` })
        .from(orders)
        .groupBy(orders.status),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(inArray(orders.status, paidStatuses)),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(and(inArray(orders.status, paidStatuses), gte(orders.paidAt, sevenDaysAgo))),
      db
        .select({
          total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(and(inArray(orders.status, paidStatuses), gte(orders.paidAt, thirtyDaysAgo))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(gte(orders.createdAt, startOfToday)),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(products),
      db.select({ count: sql<number>`count(*)::int` }).from(products).where(eq(products.active, true)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(sql`${products.stock} <= 5 AND ${products.active} = true`),
      db.select({ count: sql<number>`count(*)::int` }).from(messages),
      db.select({ count: sql<number>`count(*)::int` }).from(suggestions),
      db
      .select({
        id: products.id,
        name: products.name,
        sold: sql<number>`SUM(${orderItems.quantity})::int`,
        revenue: sql<string>`SUM(${orderItems.quantity} * ${orderItems.priceUsdt})::text`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(inArray(orders.status, paidStatuses))
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`SUM(${orderItems.quantity})`))
      .limit(5),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) statusCounts[row.status] = row.count;

    const revenueRow = revenueRows[0];
    const revenue7Row = revenue7Rows[0];
    const revenue30Row = revenue30Rows[0];
    const ordersTodayRow = ordersTodayRows[0];
    const usersRow = usersRows[0];
    const productsRow = productsRows[0];
    const activeProductsRow = activeProductsRows[0];
    const lowStockRow = lowStockRows[0];
    const messagesRow = messagesRows[0];
    const suggestionsRow = suggestionsRows[0];

    const payload = JSON.stringify({
      statusCounts,
      revenue: {
        total: revenueRow?.total ?? '0',
        totalCount: revenueRow?.count ?? 0,
        last7: revenue7Row?.total ?? '0',
        last7Count: revenue7Row?.count ?? 0,
        last30: revenue30Row?.total ?? '0',
        last30Count: revenue30Row?.count ?? 0,
      },
      ordersToday: ordersTodayRow?.count ?? 0,
      users: usersRow?.count ?? 0,
      products: {
        total: productsRow?.count ?? 0,
        active: activeProductsRow?.count ?? 0,
        lowStock: lowStockRow?.count ?? 0,
      },
      messages: messagesRow?.count ?? 0,
      suggestions: suggestionsRow?.count ?? 0,
      topProducts,
    });

    redis.set(STATS_CACHE_KEY, payload, { ex: STATS_CACHE_TTL }).catch(() => {});

    return new NextResponse(payload, {
      headers: { 'content-type': 'application/json', 'x-cache': 'MISS' },
    });
  } catch (err) {
    console.error('[GET /api/admin/stats]', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
