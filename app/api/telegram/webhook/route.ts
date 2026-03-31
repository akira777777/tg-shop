import { after } from 'next/server';
import { bot } from '@/lib/bot';

export async function POST(request: Request): Promise<Response> {
  return bot.webhooks.telegram(request, {
    waitUntil: (task) => after(() => task),
  });
}
