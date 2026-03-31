# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # ESLint
npm run db:push      # Push Drizzle schema changes to Postgres (non-destructive)
npm run db:studio    # Open Drizzle Studio (local DB GUI)
npx tsx bot-poll.ts  # Run Telegram bot in long-polling mode (local dev only)
```

No test suite is configured.

## Architecture

This is a **Telegram Mini App** e-commerce store with crypto payments. It runs as Next.js 16 App Router deployed on Vercel, embedded inside Telegram via the WebApp SDK. The UI language is Russian.

### Authentication

Every user-facing API route authenticates via Telegram's HMAC-SHA256 `initData` signature. The client sends the raw `initData` string in an `x-init-data` request header; routes call `verifyInitData()` from `lib/telegram-auth.ts` which returns the parsed `TelegramUser` or `null`.

Admin routes (`/api/admin/*`) instead check the caller's Telegram ID against `ADMIN_CHAT_IDS` via `lib/admin-auth.ts`.

For local development outside Telegram, set `NEXT_PUBLIC_ALLOW_DEV_AUTH=true` and `NEXT_PUBLIC_DEV_TELEGRAM_USER_ID=<your-id>` to get a synthetic user from `lib/telegram.ts`.

### Payment Flow

Two blockchains are supported:

- **TRC20 USDT** — A pool of pre-funded deposit addresses is seeded from `TRON_DEPOSIT_ADDRESS_POOL` (comma-separated) into a Redis set (`tron:pool:available`). `lib/tron/pool.ts` atomically pops one address per order (`acquireAddress`) and returns it after payment or expiry (`releaseAddress`).
- **TON** — A single wallet (`TON_WALLET_ADDRESS`) receives all TON payments. Orders are distinguished by a comment in the format `ORDER-{id}`. The TON amount is converted from USDT using a CoinGecko price (cached in Redis as `ton:usd_price`, 5-min TTL). Payments allow up to 1% underpayment to handle price drift.

A Vercel cron (`/api/payments/verify`, every minute, authenticated by `CRON_SECRET`) calls both monitors in parallel. Both monitors first expire stale `awaiting_payment` orders (returning TRC20 addresses to the pool), then poll their respective chain APIs.

TRC20 uses idempotency on `txHash IS NULL` before marking paid. Both monitors call `notifyPaymentConfirmed()` on success.

### Caching (Redis)

| Key | TTL | Purpose |
|---|---|---|
| `catalog:products` | 5 min | Product list (`lib/products-cache.ts`); invalidated on any admin product write |
| `tron:pool:available` | permanent | Redis set of available TRC20 deposit addresses |
| `ton:usd_price` | 5 min | TON/USD rate from CoinGecko |

### Telegram Bot (Chat SDK)

The bot uses Vercel's **Chat SDK** (`chat` + `@chat-adapter/telegram` + `@chat-adapter/state-redis`).

- **Singleton**: `lib/bot/index.ts` — creates the `Chat` instance, registers handlers, exported as `bot`.
- **Webhook**: `app/api/telegram/webhook/route.ts` — `POST` handler calls `bot.webhooks.telegram(request)` using `after()` for background processing.
- **Handlers**: `lib/bot/handlers.ts` — all bot logic in `registerBotHandlers()`:
  - `onDirectMessage` — `/start` welcome, `/status <id>` order lookup, user↔admin message relay.
  - `onSubscribedMessage` — same commands on already-subscribed threads, plus admin reply flow (thread state stores `pendingUserId`).
  - `onAction` — inline button callbacks: `my_orders`, `contact_manager`, `suggest_product`, `admin_dialogs`, `admin_orders`, `reply_to:<id>`, `admin_order_<id>`, `set_status_<id>_<status>`.
- **Raw API fallback**: `lib/bot/telegram-api.ts` — `tgSend()` uses direct Telegram Bot API for `web_app` buttons and HTML parse mode, which Chat SDK doesn't expose.
- **Notifications**: `lib/bot/notifications.ts` — `notifyPaymentConfirmed`, `notifyNewOrder`, `notifyOrderExpired`, `notifyOrderStatusChanged`, `notifyNewSuggestion`. All use `tgSend()`.
- **Local dev**: `bot-poll.ts` creates a separate `Chat` instance in polling mode (`mode: 'polling'`, `deleteWebhook: true`).

Thread state type: `{ pendingUserId?: number; pendingUserLabel?: string }` — used for the admin reply-to-user flow.

### Database

Drizzle ORM with PostgreSQL (Neon). Schema at `lib/db/schema.ts`. Tables: `users`, `products`, `orders`, `order_items`, `messages`, `suggestions`.

Order status lifecycle: `pending` → `awaiting_payment` → `paid` → `processing` → `shipped` → `delivered` (or `cancelled`).

The `messages` table tracks user↔admin relay conversations (direction: `user_to_admin` | `admin_to_user`).

### State Management

Cart is Zustand (`lib/cart-store.ts`) persisted to `localStorage`. No server-side session — user identity comes exclusively from Telegram WebApp `initData` parsed on the client (`lib/telegram.ts`) and passed via request headers to API routes.

### Admin

`/admin` is a client-side dashboard protected by `lib/admin-auth.ts` (checks `ADMIN_CHAT_IDS`). It manages products, orders, and suggestions via `/api/admin/*` routes.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username (used by Chat SDK, defaults to `shopbot`) |
| `ADMIN_CHAT_IDS` | Comma-separated admin Telegram user IDs |
| `ADMIN_CHANNEL_ID` | Optional Telegram channel for payment notifications |
| `MINI_APP_URL` | Deployed app URL (used in bot buttons) |
| `WEBHOOK_SECRET` | Secures the Telegram webhook endpoint (shared with Chat SDK adapter) |
| `TRON_DEPOSIT_ADDRESS_POOL` | Comma-separated TRC20 USDT deposit addresses |
| `TRON_USDT_CONTRACT` | TRC20 USDT contract (defaults to mainnet address) |
| `TRONGRID_API_KEY` | TronGrid API key |
| `TRONGRID_API_URL` | TronGrid base URL (optional, defaults to api.trongrid.io) |
| `TON_WALLET_ADDRESS` | Single TON receiving wallet |
| `TONCENTER_API_KEY` | TonCenter API key (optional) |
| `TONCENTER_API_URL` | TonCenter base URL (optional) |
| `PAYMENT_CONFIRMATIONS_REQUIRED` | TRC20 confirmations before marking paid (default 1) |
| `DATABASE_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Redis for address pool, product cache, TON price cache |
| `UPSTASH_REDIS_URL` | Redis connection URL (`rediss://...`) for Chat SDK state adapter |
| `CRON_SECRET` | Authenticates the payment verify cron |
| `ORDER_TTL_MINUTES` | Order expiry — TRC20 default 30 min, TON default 60 min |
| `NEXT_PUBLIC_ALLOW_DEV_AUTH` | Set `true` for dev auth bypass (dev only) |
| `NEXT_PUBLIC_DEV_TELEGRAM_USER_ID` | Synthetic user ID for dev auth bypass |
