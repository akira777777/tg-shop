import { Chat } from 'chat';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createRedisState } from '@chat-adapter/state-redis';
import { registerBotHandlers } from './handlers';

export const bot = new Chat({
  userName: process.env.TELEGRAM_BOT_USERNAME ?? 'shopbot',
  adapters: {
    telegram: createTelegramAdapter({
      // Reuses the existing WEBHOOK_SECRET env var for webhook verification
      secretToken: process.env.WEBHOOK_SECRET,
    }),
  },
  state: createRedisState({
    // Upstash provides UPSTASH_REDIS_URL (rediss://) for standard Redis clients
    url: process.env.UPSTASH_REDIS_URL ?? process.env.REDIS_URL!,
  }),
});

registerBotHandlers(bot);
