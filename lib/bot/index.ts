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

    if (!redisUrl) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[bot] UPSTASH_REDIS_URL is required in production. ' +
            'Bot thread state cannot persist across serverless invocations without Redis.',
        );
      }
      console.warn(
        '[bot] UPSTASH_REDIS_URL/REDIS_URL is not set, using in-memory state (dev only).',
      );
    }

    const state = redisUrl
      ? createRedisState({ url: redisUrl })
      : createMemoryState();

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
