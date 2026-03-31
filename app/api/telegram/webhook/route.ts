import { after } from 'next/server';
import { getBot } from '@/lib/bot';

export async function POST(request: Request): Promise<Response> {
  return getBot().webhooks.telegram(request, {
    waitUntil: (task) => after(() => task),
  });
}
