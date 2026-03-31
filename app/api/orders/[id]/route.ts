import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyInitData } from '@/lib/telegram-auth';

// GET /api/orders/:id — fetch a single order for the authenticated user
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
      .limit(1);

    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    return NextResponse.json(order);
  } catch (err) {
    console.error('[GET /api/orders/:id]', err);
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 });
  }
}

// PATCH /api/orders/:id — mark as awaiting_payment after user confirms they sent payment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });

  try {
    // Single atomic UPDATE prevents double-submission without a separate SELECT round-trip
    const [updated] = await db
      .update(orders)
      .set({ status: 'awaiting_payment' })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.userId, user.id),
          eq(orders.status, 'pending')
        )
      )
      .returning({ id: orders.id });

    if (!updated) {
      // Distinguish "not this user's order" (404) from "already transitioned" (409)
      const [exists] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
        .limit(1);

      if (!exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      return NextResponse.json({ error: 'Order already submitted' }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/orders/:id]', err);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
