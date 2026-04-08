import { db } from '@/lib/db';
import { orders, orderItems, users, products, messages, suggestions } from '@/lib/db/schema';
import { sql, and, gte, inArray, eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

/**
 * GET /api/admin/stats
 * Returns aggregate counters and revenue for the admin dashboard.
 */
export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Status counts in one query
    const statusRows = await db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .groupBy(orders.status);

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) statusCounts[row.status] = row.count;

    // Revenue: sum of totalUsdt for paid+ orders
    const paidStatuses = ['paid', 'processing', 'shipped', 'delivered'];
    const [revenueRow] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(inArray(orders.status, paidStatuses));

    // Revenue last 7 days
    const [revenue7Row] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(inArray(orders.status, paidStatuses), gte(orders.paidAt, sevenDaysAgo)));

    // Revenue last 30 days
    const [revenue30Row] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${orders.totalUsdt}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(inArray(orders.status, paidStatuses), gte(orders.paidAt, thirtyDaysAgo)));

    // Orders today (any status)
    const [ordersTodayRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(gte(orders.createdAt, startOfToday));

    // Totals
    const [[usersRow], [productsRow], [activeProductsRow], [lowStockRow], [messagesRow], [suggestionsRow]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(products),
      db.select({ count: sql<number>`count(*)::int` }).from(products).where(eq(products.active, true)),
      db.select({ count: sql<number>`count(*)::int` }).from(products).where(sql`${products.stock} <= 5 AND ${products.active} = true`),
      db.select({ count: sql<number>`count(*)::int` }).from(messages),
      db.select({ count: sql<number>`count(*)::int` }).from(suggestions),
    ]);

    // Top 5 bestsellers by quantity (paid+ orders only)
    const topProducts = await db
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
      .limit(5);

    return NextResponse.json({
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
  } catch (err) {
    console.error('[GET /api/admin/stats]', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
