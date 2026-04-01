import { after } from 'next/server';
import { getBot } from '@/lib/bot';

export async function POST(request: Request): Promise<Response> {
  try {
    return getBot().webhooks.telegram(request, {
      waitUntil: (task) => after(() => task),
    });
  } catch (err) {
    console.error('[webhook] Fatal error processing update:', err);
    // Return 200 to prevent Telegram from retrying and piling up pending updates
    return new Response('Internal error', { status: 200 });
  }
}
