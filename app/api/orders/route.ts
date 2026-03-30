import { db } from '@/lib/db';
import { orders, orderItems, products, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { acquireAddress } from '@/lib/tron/pool';
import { notifyNewOrder } from '@/lib/bot/notifications';

const CreateOrderSchema = z.object({
  userId: z.number().int(),
  firstName: z.string().min(1),
  username: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});

// GET /api/orders?userId=123  — fetch orders for a user
export async function GET(req: NextRequest): Promise<Response> {
  const userId = parseInt(req.nextUrl.searchParams.get('userId') ?? '', 10);
  if (isNaN(userId)) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  try {
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /api/orders]', err);
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 });
  }
}

// POST /api/orders  — create a new order and return payment address
export async function POST(req: NextRequest): Promise<Response> {
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

  const { userId, firstName, username, items } = parsed.data;

  try {
    // Upsert user
    await db
      .insert(users)
      .values({ telegramId: userId, firstName, username })
      .onConflictDoNothing();

    // Resolve products and compute total
    let totalUsdt = 0;
    const resolvedItems: Array<{ productId: number; quantity: number; priceUsdt: string }> = [];

    for (const item of items) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (!product || !product.active) {
        return NextResponse.json(
          { error: `Product ${item.productId} not available` },
          { status: 400 }
        );
      }
      if (product.stock < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for "${product.name}"` },
          { status: 400 }
        );
      }

      const price = parseFloat(product.priceUsdt);
      totalUsdt += price * item.quantity;
      resolvedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        priceUsdt: product.priceUsdt,
      });
    }

    // Acquire an address from the pool before creating the order
    const paymentAddress = await acquireAddress();

    const [newOrder] = await db
      .insert(orders)
      .values({
        userId,
        status: 'pending',
        totalUsdt: totalUsdt.toFixed(6),
        paymentAddress,
      })
      .returning();

    // Insert order items
    await db.insert(orderItems).values(
      resolvedItems.map((item) => ({
        orderId: newOrder.id,
        ...item,
      }))
    );

    // Fire-and-forget: notification failure must not block the order response
    notifyNewOrder({
      orderId: newOrder.id,
      userId,
      totalUsdt: totalUsdt.toFixed(6),
      itemCount: resolvedItems.length,
      username,
      firstName,
    }).catch((err) => console.error('[notify] New order notification failed:', err));

    return NextResponse.json({
      orderId: newOrder.id,
      totalUsdt: totalUsdt.toFixed(6),
      paymentAddress,
    });
  } catch (err) {
    console.error('[POST /api/orders]', err);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
