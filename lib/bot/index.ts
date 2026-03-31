import { Chat } from 'chat';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createRedisState } from '@chat-adapter/state-redis';
import { createMemoryState } from '@chat-adapter/state-memory';
import { registerBotHandlers } from './handlers';

// Lazy singleton — avoids crashing the Next.js build which evaluates this
// module at compile time when REDIS_URL is not yet available.
let _bot: Chat | undefined;

export function getBot(): Chat {
  if (!_bot) {
    const redisUrl = process.env.UPSTASH_REDIS_URL ?? process.env.REDIS_URL;
    const state = redisUrl
      ? createRedisState({ url: redisUrl })
      : createMemoryState();

    if (!redisUrl) {
      console.warn(
        '[bot] UPSTASH_REDIS_URL/REDIS_URL is not set, using in-memory state. ' +
          'Configure Redis for production webhooks.',
      );
    }

    _bot = new Chat({
      userName: process.env.TELEGRAM_BOT_USERNAME ?? 'shopbot',
      adapters: {
        telegram: createTelegramAdapter({
          secretToken: process.env.WEBHOOK_SECRET,
        }),
      },
      state,
    });
    registerBotHandlers(_bot);
  }
  return _bot;
}
