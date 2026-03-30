import { db } from '@/lib/db';
import { suggestions, users } from '@/lib/db/schema';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SuggestionSchema = z.object({
  userId: z.number().int(),
  firstName: z.string().min(1),
  username: z.string().optional(),
  productName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = SuggestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { userId, firstName, username, productName, description } = parsed.data;

  try {
    await db
      .insert(users)
      .values({ telegramId: userId, firstName, username })
      .onConflictDoNothing();

    await db.insert(suggestions).values({ userId, productName, description });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/suggestions]', err);
    return NextResponse.json({ error: 'Failed to save suggestion' }, { status: 500 });
  }
}
