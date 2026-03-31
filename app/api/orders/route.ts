import { db } from '@/lib/db';
import { orders, orderItems, products, users } from '@/lib/db/schema';
import { eq, desc, sql, and, gte } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { notifyNewOrder } from '@/lib/bot/notifications';
import { acquireAddress, releaseAddress } from '@/lib/tron/pool';
import { getTonUsdPrice, usdtToTon, orderComment } from '@/lib/ton/price';
import { verifyInitData } from '@/lib/telegram-auth';

const CreateOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
  paymentMethod: z.enum(['trc20', 'ton']).default('trc20'),
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

  const { items, paymentMethod } = parsed.data;

  // Acquire payment address before the DB transaction (Redis is outside the DB tx)
  let paymentAddress: string;
  try {
    if (paymentMethod === 'trc20') {
      paymentAddress = await acquireAddress();
    } else {
      const tonWallet = process.env.TON_WALLET_ADDRESS;
      if (!tonWallet) {
        return NextResponse.json({ error: 'TON wallet not configured' }, { status: 500 });
      }
      paymentAddress = tonWallet;
    }
  } catch (err) {
    console.error('[POST /api/orders] Address acquisition failed:', err);
    return NextResponse.json({ error: 'Payment method temporarily unavailable' }, { status: 503 });
  }

  try {
    // Upsert user record
    await db
      .insert(users)
      .values({ telegramId: user.id, firstName: user.first_name, username: user.username })
      .onConflictDoNothing();

    // Resolve products and compute total using integer micro-USDT to avoid float drift
    let totalMicro = 0n;
    const resolvedItems: Array<{ productId: number; quantity: number; priceUsdt: string }> = [];

    for (const item of items) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      if (!product || !product.active) {
        if (paymentMethod === 'trc20') await releaseAddress(paymentAddress).catch(() => {});
        return NextResponse.json({ error: `Product ${item.productId} not available` }, { status: 400 });
      }
      if (product.stock < item.quantity) {
        if (paymentMethod === 'trc20') await releaseAddress(paymentAddress).catch(() => {});
        return NextResponse.json({ error: `Insufficient stock for "${product.name}"` }, { status: 400 });
      }

      // Parse price string e.g. "10.500000" → micro-USDT BigInt
      const [whole, frac = ''] = product.priceUsdt.split('.');
      const fracPadded = frac.padEnd(6, '0').slice(0, 6);
      const priceMicro = BigInt(whole) * 1_000_000n + BigInt(fracPadded);
      totalMicro += priceMicro * BigInt(item.quantity);

      resolvedItems.push({ productId: item.productId, quantity: item.quantity, priceUsdt: product.priceUsdt });
    }

    // Format total as "X.XXXXXX"
    const totalWhole = totalMicro / 1_000_000n;
    const totalFrac = totalMicro % 1_000_000n;
    const totalUsdt = `${totalWhole}.${totalFrac.toString().padStart(6, '0')}`;

    // Compute TON equivalent if needed
    let paymentAmountTon: string | undefined;
    if (paymentMethod === 'ton') {
      try {
        const tonUsdPrice = await getTonUsdPrice();
        const tonAmount = usdtToTon(Number(totalMicro) / 1_000_000, tonUsdPrice);
        paymentAmountTon = tonAmount.toFixed(9);
      } catch (err) {
        console.error('[POST /api/orders] TON price fetch failed:', err);
        return NextResponse.json({ error: 'Failed to fetch TON exchange rate' }, { status: 503 });
      }
    }

    let newOrderId!: number;
    try {
      await db.transaction(async (tx) => {
        const [newOrder] = await tx
          .insert(orders)
          .values({
            userId: user.id,
            status: 'pending',
            totalUsdt,
            paymentMethod,
            paymentAddress,
            paymentAmountTon: paymentAmountTon ?? null,
          })
          .returning();
        newOrderId = newOrder.id;

        await tx.insert(orderItems).values(
          resolvedItems.map((item) => ({ orderId: newOrder.id, ...item }))
        );

        // Atomic stock decrement — fails if a concurrent order depleted stock
        for (const item of resolvedItems) {
          const [decremented] = await tx
            .update(products)
            .set({ stock: sql`${products.stock} - ${item.quantity}` })
            .where(and(eq(products.id, item.productId), gte(products.stock, item.quantity)))
            .returning({ id: products.id });

          if (!decremented) {
            throw new Error(`Stock depleted for product ${item.productId}`);
          }
        }
      });
    } catch (err: unknown) {
      if (paymentMethod === 'trc20') await releaseAddress(paymentAddress).catch(() => {});
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('Stock depleted')) {
        return NextResponse.json(
          { error: 'A product sold out during checkout. Please review your cart.' },
          { status: 409 }
        );
      }
      throw err;
    }

    // Fire-and-forget: notification failure must not block the order response
    notifyNewOrder({
      orderId: newOrderId,
      userId: user.id,
      totalUsdt,
      itemCount: resolvedItems.length,
      username: user.username,
      firstName: user.first_name,
    }).catch((err) => console.error('[notify] New order notification failed:', err));

    return NextResponse.json({
      orderId: newOrderId,
      totalUsdt,
      paymentAddress,
      paymentMethod,
      ...(paymentAmountTon
        ? { paymentAmountTon, comment: orderComment(newOrderId) }
        : {}),
    });
  } catch (err) {
    console.error('[POST /api/orders]', err);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}
