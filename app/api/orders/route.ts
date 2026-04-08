import { db } from '@/lib/db';
import { orders, orderItems, products, users } from '@/lib/db/schema';
import { eq, desc, sql, and, gte, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { notifyNewOrder } from '@/lib/bot/notifications';
import { invalidateProductsCache } from '@/lib/products-cache';
import { acquireAddress, releaseAddress } from '@/lib/tron/pool';
import { verifyInitData } from '@/lib/telegram-auth';
import { redis } from '@/lib/redis';

const MICRO_USDT = BigInt(1_000_000);
const ORDER_RATE_LIMIT = 5;   // max orders per window per user
const ORDER_RATE_WINDOW = 60; // seconds

const CreateOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});

// GET /api/orders — fetch orders for the authenticated user, including items
export async function GET(req: NextRequest): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        totalUsdt: orders.totalUsdt,
        paymentMethod: orders.paymentMethod,
        paymentAddress: orders.paymentAddress,
        paymentAmountTon: orders.paymentAmountTon,
        txHash: orders.txHash,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        itemName: products.name,
        itemQty: orderItems.quantity,
        itemPrice: orderItems.priceUsdt,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orders.userId, user.id))
      .orderBy(desc(orders.createdAt));

    // Group rows by order — one DB row per item due to the JOIN
    const orderMap = new Map<
      number,
      {
        id: number;
        userId: number | null;
        status: string;
        totalUsdt: string;
        paymentMethod: string;
        paymentAddress: string;
        paymentAmountTon: string | null;
        txHash: string | null;
        createdAt: Date | null;
        paidAt: Date | null;
        items: { name: string; quantity: number; priceUsdt: string }[];
      }
    >();

    for (const row of rows) {
      if (!orderMap.has(row.id)) {
        orderMap.set(row.id, {
          id: row.id,
          userId: row.userId,
          status: row.status,
          totalUsdt: row.totalUsdt,
          paymentMethod: row.paymentMethod,
          paymentAddress: row.paymentAddress,
          paymentAmountTon: row.paymentAmountTon,
          txHash: row.txHash,
          createdAt: row.createdAt,
          paidAt: row.paidAt,
          items: [],
        });
      }
      if (row.itemName != null && row.itemQty != null && row.itemPrice != null) {
        orderMap.get(row.id)!.items.push({
          name: row.itemName,
          quantity: row.itemQty,
          priceUsdt: row.itemPrice,
        });
      }
    }

    return NextResponse.json([...orderMap.values()]);
  } catch (err) {
    console.error('[GET /api/orders]', err);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}

// POST /api/orders — create a new order and return payment details
export async function POST(req: NextRequest): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: max ORDER_RATE_LIMIT orders per ORDER_RATE_WINDOW seconds per user.
  // Use a pipeline so INCR and EXPIRE NX are sent atomically — prevents a race where
  // a cold-start INCR sets count=1 but crashes before EXPIRE, leaving a permanent key.
  const rlKey = `ratelimit:orders:${user.id}`;
  const rlPipeline = redis.pipeline();
  rlPipeline.incr(rlKey);
  rlPipeline.expire(rlKey, ORDER_RATE_WINDOW, 'NX'); // NX: only set TTL on first hit
  const [count] = await rlPipeline.exec<[number, number]>();
  if (count > ORDER_RATE_LIMIT) {
    return NextResponse.json(
      { error: 'Слишком много заявок. Попробуйте через минуту.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { items } = parsed.data;
  const paymentMethod = 'trc20' as const;

  // Acquire payment address before the DB transaction (Redis is outside the DB tx)
  let paymentAddress: string;
  try {
    paymentAddress = await acquireAddress();
  } catch (err) {
    console.error('[POST /api/orders] Address acquisition failed:', err);
    return NextResponse.json({ error: 'Payment method temporarily unavailable' }, { status: 503 });
  }

  try {
    // Upsert user record — update name/username in case they changed in Telegram
    await db
      .insert(users)
      .values({ telegramId: user.id, firstName: user.first_name, username: user.username })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { firstName: user.first_name, username: user.username },
      });

    // Fetch all needed products in one query instead of N individual lookups
    const productIds = [...new Set(items.map((i) => i.productId))];
    const productRows = await db
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.active, true)));
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    // Resolve products and compute total using integer micro-USDT to avoid float drift
    let totalMicro = BigInt(0);
    const resolvedItems: Array<{ productId: number; quantity: number; priceUsdt: string }> = [];

    for (const item of items) {
      const product = productMap.get(item.productId);

      if (!product) {
        await releaseAddress(paymentAddress).catch(() => {});
        return NextResponse.json({ error: `Product ${item.productId} not available` }, { status: 400 });
      }
      if (product.stock < item.quantity) {
        await releaseAddress(paymentAddress).catch(() => {});
        return NextResponse.json({ error: `Insufficient stock for "${product.name}"` }, { status: 400 });
      }

      // Parse price string e.g. "10.500000" → micro-USDT BigInt
      const [whole, frac = ''] = product.priceUsdt.split('.');
      const fracPadded = frac.padEnd(6, '0').slice(0, 6);
      const priceMicro = BigInt(whole) * MICRO_USDT + BigInt(fracPadded);
      totalMicro += priceMicro * BigInt(item.quantity);

      resolvedItems.push({ productId: item.productId, quantity: item.quantity, priceUsdt: product.priceUsdt });
    }

    // Format total as "X.XXXXXX"
    const totalWhole = totalMicro / MICRO_USDT;
    const totalFrac = totalMicro % MICRO_USDT;
    const totalUsdt = `${totalWhole}.${totalFrac.toString().padStart(6, '0')}`;

    // Insert order — neon-http does not support db.transaction(), so we manage
    // atomicity manually: insert order first, then items + stock decrements with
    // compensating rollback on any failure.
    const [newOrder] = await db
      .insert(orders)
      .values({
        userId: user.id,
        status: 'awaiting_payment',
        totalUsdt,
        paymentMethod,
        paymentAddress,
      })
      .returning();
    const newOrderId = newOrder.id;

    // Helper: cancel the order and release the payment address on failure
    const rollback = async () => {
      await db
        .update(orders)
        .set({ status: 'cancelled' })
        .where(eq(orders.id, newOrderId))
        .catch(() => {});
      await releaseAddress(paymentAddress).catch(() => {});
    };

    try {
      await db.insert(orderItems).values(
        resolvedItems.map((item) => ({ orderId: newOrderId, ...item }))
      );
    } catch (err) {
      await rollback();
      throw err;
    }

    // Atomic stock decrement per item — WHERE stock >= quantity prevents overselling.
    // Track successfully decremented items so we can restore them if a later item fails.
    const decremented: { productId: number; quantity: number }[] = [];
    for (const item of resolvedItems) {
      const [updated] = await db
        .update(products)
        .set({ stock: sql`${products.stock} - ${item.quantity}` })
        .where(and(eq(products.id, item.productId), gte(products.stock, item.quantity)))
        .returning({ id: products.id });

      if (!updated) {
        // Restore already-decremented items
        for (const d of decremented) {
          await db
            .update(products)
            .set({ stock: sql`${products.stock} + ${d.quantity}` })
            .where(eq(products.id, d.productId))
            .catch(() => {});
        }
        await rollback();
        return NextResponse.json(
          { error: 'A product sold out during checkout. Please review your cart.' },
          { status: 409 }
        );
      }
      decremented.push({ productId: item.productId, quantity: item.quantity });
    }

    // Invalidate product cache so next catalog load reflects updated stock
    invalidateProductsCache().catch((err) =>
      console.error('[POST /api/orders] Cache invalidation failed:', err)
    );

    // Fire-and-forget: notification failure must not block the order response
    notifyNewOrder({
      orderId: newOrderId,
      userId: user.id,
      totalUsdt,
      itemCount: resolvedItems.length,
      username: user.username,
      firstName: user.first_name,
      itemNames: resolvedItems.map((item) => productMap.get(item.productId)!.name),
    }).catch((err) => console.error('[notify] New order notification failed:', err));

    return NextResponse.json({
      orderId: newOrderId,
      totalUsdt,
      paymentAddress,
      paymentMethod,
    });
  } catch (err) {
    console.error('[POST /api/orders]', err);
    // Release address if it was acquired — sadd is idempotent so double-release is safe
    await releaseAddress(paymentAddress).catch(() => {});
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
