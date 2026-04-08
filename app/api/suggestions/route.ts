import { db } from '@/lib/db';
import { suggestions, users } from '@/lib/db/schema';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyInitData } from '@/lib/telegram-auth';
import { notifyNewSuggestion } from '@/lib/bot/notifications';
import { redis } from '@/lib/redis';

const SuggestionSchema = z.object({
  productName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

// Max 3 suggestions per user per hour
const SUGGESTION_RATE_LIMIT = 3;
const SUGGESTION_RATE_WINDOW = 60 * 60; // 1 hour in seconds

export async function POST(req: NextRequest): Promise<Response> {
  const user = verifyInitData(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: max SUGGESTION_RATE_LIMIT suggestions per hour per user
  const rlKey = `ratelimit:suggestions:${user.id}`;
  const rlPipeline = redis.pipeline();
  rlPipeline.incr(rlKey);
  rlPipeline.expire(rlKey, SUGGESTION_RATE_WINDOW, 'NX');
  const [count] = await rlPipeline.exec<[number, number]>();
  if (count > SUGGESTION_RATE_LIMIT) {
    return NextResponse.json(
      { error: 'Слишком много предложений. Попробуйте позже.' },
      { status: 429 },
    );
  }

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

  const { productName, description } = parsed.data;

  try {
    await db
      .insert(users)
      .values({ telegramId: user.id, firstName: user.first_name, username: user.username })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { firstName: user.first_name, username: user.username },
      });

    await db.insert(suggestions).values({ userId: user.id, productName, description });

    notifyNewSuggestion({
      userId: user.id,
      productName,
      description,
      username: user.username,
      firstName: user.first_name,
    }).catch((err) => console.error('[notify] Suggestion notification failed:', err));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/suggestions]', err);
    return NextResponse.json({ error: 'Failed to save suggestion' }, { status: 500 });
  }
}
