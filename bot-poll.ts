import 'dotenv/config';
import { Chat } from 'chat';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createRedisState } from '@chat-adapter/state-redis';
import { createMemoryState } from '@chat-adapter/state-memory';
import { registerBotHandlers } from './lib/bot/handlers';

// Stand-alone long-polling entry point for local development.
// Creates its own bot instance in polling mode so it can delete the webhook
// and receive updates via getUpdates without conflicting with the webhook bot.
const redisUrl = process.env.UPSTASH_REDIS_URL ?? process.env.REDIS_URL;
const state = redisUrl
  ? createRedisState({ url: redisUrl })
  : createMemoryState();

if (!redisUrl) {
  console.warn(
    '[bot-poll] UPSTASH_REDIS_URL/REDIS_URL is not set, using in-memory state.',
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
