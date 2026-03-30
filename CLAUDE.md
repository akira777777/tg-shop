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

This is a **Telegram Mini App** e-commerce store with crypto payments. It runs as a Next.js App Router application deployed on Vercel, embedded inside Telegram via the WebApp SDK.

### Payment Flow

Two blockchains are supported:

- **TRC20 USDT** — HD wallet derivation (`lib/tron/pool.ts`) generates a unique deposit address per order from `HD_WALLET_SEED`. Addresses are pooled in Redis and returned to the pool after order completion.
- **TON** — A single wallet address receives all TON payments. Orders are distinguished by a unique comment (`lib/ton/price.ts`).

A Vercel cron (`/api/payments/verify`, runs every minute) polls TronGrid and TonCenter APIs to detect on-chain payments and update order status.

### Telegram Bot

The bot (`lib/bot/`) runs as a webhook on `/api/telegram/webhook`. It handles:
- `/start` with inline web app button
- User↔admin relay messaging: messages from users are forwarded to `ADMIN_GROUP_ID`; replies in that group are forwarded back to users
- Order status change notifications (`lib/bot/notifications.ts`)

For local dev, `bot-poll.ts` enables long-polling instead of a webhook.

### Database

Drizzle ORM with PostgreSQL (Neon). Schema: `lib/db/schema.ts`. Key tables: `users`, `products`, `orders`, `orderItems`, `messages`, `suggestions`.

Order status lifecycle: `pending` → `awaiting_payment` → `paid` → `processing` → `shipped` → `delivered` (or `cancelled`).

### State Management

Cart is Zustand (`lib/cart-store.ts`) persisted to `localStorage`. There is no server-side session — user identity comes exclusively from the Telegram WebApp `initData` parsed on the client (`lib/telegram.ts`) and passed to API routes.

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
| `HD_WALLET_SEED` | 64-byte hex seed for TRC20 address derivation |
| `USDT_CONTRACT` | TRC20 USDT contract address |
| `TRONGRID_API_KEY` | TronGrid API key |
| `TON_WALLET_ADDRESS` | Single TON receiving wallet |
| `DATABASE_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Redis for address pool & temp state |
| `CRON_SECRET` | Authenticates the payment verify cron |
| `ORDER_TTL_MINUTES` | Order expiry (default 30) |
