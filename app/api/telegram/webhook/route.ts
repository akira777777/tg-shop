import { webhookCallback } from 'grammy';
import { bot } from '@/lib/bot';

// Grammy webhook handler — validated via WEBHOOK_SECRET token
const handler = webhookCallback(bot, 'std/http', {
  secretToken: process.env.WEBHOOK_SECRET,
});

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
