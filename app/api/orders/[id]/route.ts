import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/orders/:id?userId=123
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const orderId = parseInt(id, 10);
  const userId = parseInt(req.nextUrl.searchParams.get('userId') ?? '', 10);

  if (isNaN(orderId) || isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch (err) {
    console.error('[GET /api/orders/:id]', err);
    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 });
  }
}

// PATCH /api/orders/:id  — mark as awaiting_payment after user confirms send
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const orderId = parseInt(id, 10);

  let body: { userId?: number; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.userId || isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  // Only allow user to mark their own pending order as awaiting_payment
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, body.userId)))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Order already submitted' }, { status: 409 });
    }

    await db
      .update(orders)
      .set({ status: 'awaiting_payment' })
      .where(eq(orders.id, orderId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/orders/:id]', err);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
