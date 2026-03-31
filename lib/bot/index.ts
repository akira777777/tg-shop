import { Chat } from 'chat';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createMemoryState } from '@chat-adapter/state-memory';
import { Redis } from '@upstash/redis';
import { createUpstashState } from './upstash-state';
import { registerBotHandlers } from './handlers';

// Lazy singleton — avoids crashing the Next.js build which evaluates this
// module at compile time when env vars are not yet available.
let _bot: Chat | undefined;

export function getBot(): Chat {
  if (!_bot) {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!restUrl || !restToken) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[bot] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production. ' +
            'Bot thread state cannot persist across serverless invocations without Redis.',
        );
      }
      console.warn(
        '[bot] UPSTASH_REDIS_REST_URL/TOKEN not set, using in-memory state (dev only).',
      );
    }

    // Use Upstash REST adapter (HTTP/443) — the TCP adapter (@chat-adapter/state-redis)
    // hangs on cold starts because Upstash's TCP port 6380 is unreachable from Vercel serverless.
    const state =
      restUrl && restToken
        ? createUpstashState(new Redis({ url: restUrl, token: restToken }))
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
