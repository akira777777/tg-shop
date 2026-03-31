import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { notifyOrderStatusChanged } from '@/lib/bot/notifications';

const VALID_STATUSES = [
  'pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled',
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (isNaN(orderId)) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(orders)
      .set({
        status: body.status,
        ...(body.status === 'paid' ? { paidAt: new Date() } : {}),
      })
      .where(eq(orders.id, orderId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (updated.userId) {
      notifyOrderStatusChanged(updated.userId, orderId, body.status).catch(() => {});
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[PATCH /api/admin/orders/:id]', err);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}
