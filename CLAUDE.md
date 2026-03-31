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
node bot-poll.ts     # Run Telegram bot in long-polling mode (local dev only)
```

No test suite is configured.

## Architecture

This is a **Telegram Mini App** e-commerce store with crypto payments. It runs as Next.js App Router deployed on Vercel, embedded inside Telegram via the WebApp SDK.

### Authentication

Every user-facing API route authenticates via Telegram's HMAC-SHA256 `initData` signature. The client sends the raw `initData` string in an `x-init-data` request header; routes call `verifyInitData()` from `lib/telegram-auth.ts` which returns the parsed `TelegramUser` or `null`.

Admin routes (`/api/admin/*`) instead check the caller's Telegram ID against `ADMIN_CHAT_IDS` via `lib/admin-auth.ts`.

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

### Telegram Bot

The bot (`lib/bot/`) runs as a webhook on `/api/telegram/webhook`. It handles:
- `/start` — sends inline web app button
- User↔admin relay: messages from users are forwarded to `ADMIN_GROUP_ID`; replies in that group are forwarded back to the user
- Order status notifications (`lib/bot/notifications.ts`)

For local dev, `bot-poll.ts` enables long-polling instead of a webhook.

### Database

Drizzle ORM with PostgreSQL (Neon). Schema at `lib/db/schema.ts`.

Order status lifecycle: `pending` → `awaiting_payment` → `paid` → `processing` → `shipped` → `delivered` (or `cancelled`).

### State Management

Cart is Zustand (`lib/cart-store.ts`) persisted to `localStorage`. No server-side session — user identity comes exclusively from Telegram WebApp `initData` parsed on the client (`lib/telegram.ts`) and passed via request headers to API routes.

### Admin

`/admin` is a client-side dashboard protected by `lib/admin-auth.ts` (checks `ADMIN_CHAT_IDS`). It manages products, orders, and suggestions via `/api/admin/*` routes.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `ADMIN_GROUP_ID` | Telegram group for admin relay |
| `ADMIN_CHAT_IDS` | Comma-separated admin Telegram user IDs |
| `MINI_APP_URL` | Deployed app URL (used in bot buttons) |
| `WEBHOOK_SECRET` | Secures the Telegram webhook endpoint |
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
| `CRON_SECRET` | Authenticates the payment verify cron |
| `ORDER_TTL_MINUTES` | Order expiry — TRC20 default 30 min, TON default 60 min |
