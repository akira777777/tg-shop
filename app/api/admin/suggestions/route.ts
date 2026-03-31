import { db } from '@/lib/db';
import { suggestions } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyAdmin(req.headers.get('x-telegram-init-data') ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await db
      .select()
      .from(suggestions)
      .orderBy(desc(suggestions.createdAt))
      .limit(100);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /api/admin/suggestions]', err);
    return NextResponse.json({ error: 'Failed to load suggestions' }, { status: 500 });
  }
}
