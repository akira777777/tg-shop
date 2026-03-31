import 'dotenv/config';
import { Chat } from 'chat';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createMemoryState } from '@chat-adapter/state-memory';
import { Redis } from '@upstash/redis';
import { createUpstashState } from './lib/bot/upstash-state';
import { registerBotHandlers } from './lib/bot/handlers';

// Stand-alone long-polling entry point for local development.
// Creates its own bot instance in polling mode so it can delete the webhook
// and receive updates via getUpdates without conflicting with the webhook bot.
const restUrl = process.env.UPSTASH_REDIS_REST_URL;
const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const state =
  restUrl && restToken
    ? createUpstashState(new Redis({ url: restUrl, token: restToken }))
    : createMemoryState();

if (!restUrl || !restToken) {
  console.warn(
    '[bot-poll] UPSTASH_REDIS_REST_URL/TOKEN not set, using in-memory state.',
  );
}

const pollBot = new Chat({
  userName: process.env.TELEGRAM_BOT_USERNAME ?? 'shopbot',
  adapters: {
    telegram: createTelegramAdapter({
      mode: 'polling',
      longPolling: { deleteWebhook: true },
      secretToken: process.env.WEBHOOK_SECRET,
    }),
  },
  state,
});

registerBotHandlers(pollBot);

console.log('Starting bot in long-polling mode…');
pollBot.initialize().catch((err) => {
  console.error('Bot crashed:', err);
  process.exit(1);
});
