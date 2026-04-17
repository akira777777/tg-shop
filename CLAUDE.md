# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL: This is NOT the Next.js you know

This project runs **Next.js 16** (canary). APIs, conventions, and file structure **differ from training data and may have breaking changes**. Before writing or modifying any Next.js code, **read the relevant guide in `node_modules/next/dist/docs/`** — it is the source of truth. Heed deprecation notices.

Key Next.js 16 patterns used in this codebase:
- **`after()`** — imported from `next/server`, used in the webhook route to run bot logic post-response. Not the same as `waitUntil`.
- **React 19** — App Router uses React canary (19.x); server components are the default.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # ESLint (flat config, eslint-config-next)
npm run bot:poll     # Run Telegram bot in long-polling mode (local dev only)
npm run db:push      # Push Drizzle schema changes to Postgres (non-destructive)
npm run db:studio    # Open Drizzle Studio (local DB GUI)
npx tsx lib/bot/setup.ts  # One-time: register bot commands + menu button with Telegram
```

**`db:push` gotcha**: `drizzle-kit` does not auto-load `.env.local`. Pass `DATABASE_URL` explicitly:
```bash
DATABASE_URL='postgresql://...' npm run db:push
```

**Package manager**: The repo has both `pnpm-lock.yaml` (used by Vercel CI) and `package-lock.json`. Vercel builds with pnpm. Use `pnpm` for local installs to avoid lock-file drift.

No test suite is configured.

Installation and deployment is documented in **README.md** — user-facing guide in Russian with env vars, QStash setup, and admin panel walkthrough.

## Key Library Notes

- **UI components**: `@base-ui/react` (headless, Radix/MUI lineage) — **not shadcn/ui**. Custom wrappers live in `components/ui/`. `cn()` exists in `lib/utils.ts` (clsx + tailwind-merge). Do not assume other shadcn primitives exist.
- **Zod v4** (`^4.3.6`): Error shape API differs from v3. Use `.flatten()` from `z.ZodError` — `error.flatten()` returns `{ formErrors, fieldErrors }` as in v3, but import paths changed. Use `import { z } from 'zod'` (not `zod/v3`).
- **Tailwind CSS v4**: Config uses `@tailwindcss/postcss`, not the v3 `tailwind.config.js` approach.
- **CVA** (`class-variance-authority`): Used for component variant definitions in `components/ui/`.

## Architecture

This is a **Telegram Mini App** e-commerce store with crypto payments. It runs as Next.js 16 App Router deployed on Vercel, embedded inside Telegram via the WebApp SDK. The UI language is Russian.

### Authentication

Every user-facing API route authenticates via Telegram's HMAC-SHA256 `initData` signature. The client sends the raw `initData` string in an `x-telegram-init-data` request header; routes call `verifyInitData()` from `lib/telegram-auth.ts` which returns the parsed `TelegramUser` or `null`. `initData` older than 24 hours is rejected to prevent replay attacks.

**HMAC note**: `lib/telegram-auth.ts` uses `createHmac(algo, 'WebAppData').update(botToken)` — this is correct per the Telegram spec. Do not change it.

Admin routes (`/api/admin/*`) instead check the caller's Telegram ID against `ADMIN_CHAT_IDS` via `lib/admin-auth.ts`.

For local development outside Telegram, set `NEXT_PUBLIC_ALLOW_DEV_AUTH=true` and `NEXT_PUBLIC_DEV_TELEGRAM_USER_ID=<your-id>` to get a synthetic user from `lib/telegram.ts`.

### Payment Flow

**Only TRC20 USDT is supported.** (TON was removed — see git history; DB columns `paymentAmountTon` and `payment_method` are retained for historical rows but new orders are always `trc20`.)

- A pool of pre-funded deposit addresses is seeded from `TRON_DEPOSIT_ADDRESS_POOL` (comma-separated) into a Redis set (`tron:pool:available`). `lib/tron/pool.ts` atomically pops one address per order (`acquireAddress`) and returns it after payment or expiry (`releaseAddress`).

Payment verification runs every minute via **Upstash QStash** (not a Vercel cron — Hobby plan only allows daily). QStash calls `POST /api/payments/verify` with `Authorization: Bearer <CRON_SECRET>`. The cron first expires stale `awaiting_payment` orders (returning TRC20 addresses to the pool), then polls TronGrid for new transactions, **and** runs `ensureWebhook()` (`lib/bot/ensure-webhook.ts`) to self-heal the Telegram webhook registration. `vercel.json` is intentionally empty (`{}`).

To set up the QStash schedule: create a schedule in the Upstash console (or via API) with `rate: every 1 minute`, target URL `https://<your-domain>/api/payments/verify`, and header `Authorization: Bearer <CRON_SECRET>`.

TRC20 uses idempotency on `txHash IS NULL` before marking paid. On success `notifyPaymentConfirmed()` is called.

Shared helpers called from both the cron and the bot:

- `lib/restore-stock.ts` — `restoreStock(orderIds, logPrefix)` aggregates quantities per product across cancelled orders and bumps `products.stock` with `Promise.allSettled` (one failure doesn't block others).
- `lib/monitor-utils.ts` — `sendExpiryWarnings(orders, ttlMinutes)` fires the 70%-elapsed warning, deduplicated via the `expiry_warn:<orderId>` Redis key.

### Caching (Redis)

| Key | TTL | Purpose |
|---|---|---|
| `catalog:products` | 5 min | Product list (`lib/products-cache.ts`); invalidated on any admin product write **and** on new order creation (stock changes) |
| `tron:pool:available` | permanent | Redis set of available TRC20 deposit addresses |
| `user_lang:<id>` | permanent | User bot locale (`ru`/`en`), set from webhook `language_code` or `/api/user/lang` |
| `bot:webhook_ok` | 5 min | Healthy-state cache for `ensureWebhook()` self-healer |
| `ratelimit:orders:{userId}` | 60 s | Order creation rate limit counter — max 5 orders per 60 s per user (set on first hit via `INCR`/`EXPIRE`) |
| `expiry_warn:<orderId>` | ORDER_TTL_MINUTES × 60 s | Prevents duplicate pre-expiry payment warnings (SET NX) |
| `admin:stats` | 30 s | `/api/admin/stats` payload — 12 aggregate queries run in parallel (`Promise.all`), result cached as a JSON string. Admin dashboard polls frequently; real-time isn't required. |
| `pending_news:<adminId>` | — | `/news` command state machine (`awaiting_text` / `awaiting_confirm`). Checked **before** `pendingReply` so `/news` isn't hijacked by an open admin reply thread. |

### Telegram Bot (Chat SDK)

The bot uses Vercel's **Chat SDK** (`chat` + `@chat-adapter/telegram`).

- **Singleton**: `lib/bot/index.ts` — lazy init via `getBot()` (not a direct `bot` export). `getBot()` creates the `Chat` instance on first call and caches it in a module-level variable.
- **Webhook**: `app/api/telegram/webhook/route.ts` — `POST` handler calls `getBot().webhooks.telegram(request, { waitUntil: (task) => after(() => task) })`. Uses Next.js `after()` (not `waitUntil` directly) so the response returns immediately while bot logic runs post-response.
- **Handlers**: `lib/bot/handlers.ts` — all bot logic in `registerBotHandlers()`:
  - `dispatchCommand()` — shared command router for `/start`, `/status`, `/orders`, `/help`. Used by both `onDirectMessage` and `onSubscribedMessage` to avoid duplication.
  - `onDirectMessage` — subscribes thread, dispatches commands, relays free-text to admins.
  - `onSubscribedMessage` — dispatches commands, handles admin reply flow (thread state stores `pendingUserId`), notifies other admins when one replies.
  - `onAction` — inline button callbacks: `my_orders`, `contact_manager`, `suggest_product`, `admin_dialogs`, `admin_panel`, `admin_orders`, `admin_orders_f:<status>` (filtered orders), `reply_to:<id>` (shows conversation history), `admin_order_<id>`, `set_status_<id>_<status>`, `confirm_cancel_<id>`.
  - `cancelOrder()` — helper for order cancellation with stock restore, TRC20 address release, and status guard (`WHERE status NOT IN ('cancelled', 'delivered')`).
- **Raw API fallback**: `lib/bot/telegram-api.ts` — `tgSend()` / `tgEditMessageText()` / `tgDeleteMessage()` use direct Telegram Bot API for `web_app` buttons, HTML parse mode, and channel post editing (not exposed by Chat SDK). `tgSend()` returns `{ messageId }`.
- **Notifications**: `lib/bot/notifications.ts` — `notifyPaymentConfirmed`, `notifyNewOrder`, `notifyOrderExpired`, `notifyOrderStatusChanged`, `notifyExpiryWarning`, `notifyNewSuggestion`. All use `tgSend()`. Pre-expiry warnings fire at 70% of `ORDER_TTL_MINUTES` and are deduplicated via Redis key `expiry_warn:<orderId>`.
- **Broadcast channel**: `lib/bot/broadcast.ts` — `postAnnouncement()`, `postProduct()`, `markProductRemoved()`, `deleteChannelMessage()`. All target `BROADCAST_CHANNEL_ID`; if unset the helpers throw `BroadcastNotConfiguredError` (callers catch and degrade gracefully). Every broadcast-side failure is **non-fatal** at the call site — admin UI / bot flows never fail because a channel edit didn't go through. Product deactivation / stock-zero transitions in `PATCH /api/admin/products/[id]` automatically edit the existing channel post to "Снят с продажи" via `markProductRemoved()`. Note Telegram's **48h bot delete limit** — older posts can only be edited, not deleted.
- **`/news` command**: admin-only conversation flow tracked via Redis key `pending_news:<adminId>` with stages `awaiting_text` / `awaiting_confirm`. In `handleAdminMessage`, pendingNews is checked **before** pendingReply so `/news` intent isn't hijacked by an open reply thread. `/cancel` clears both pending states. Confirmation inserts an `announcements` row (`source: 'bot_command'`), posts to the channel, then updates the row with `channelMessageId`/`sentAt` — or `errorMessage` on failure.
- **Admin-scoped commands**: `lib/bot/setup.ts` calls `setMyCommands` with `scope: { type: 'chat', chat_id: <adminId> }` for each `ADMIN_CHAT_IDS` entry, so `/news` and `/cancel` appear only in admins' command menus. Run `npx tsx lib/bot/setup.ts` after changing admin IDs or command lists.
- **Local dev**: `bot-poll.ts` (repo root) creates a **separate** `Chat` instance in polling mode (`mode: 'polling'`, `deleteWebhook: true`). It does not reuse `getBot()` from `lib/bot/index.ts`. **Warning**: Running `bot-poll.ts` deletes the production webhook. After switching back to production, re-register it:
  ```bash
  curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
    -d "url=https://<DOMAIN>/api/telegram/webhook" \
    -d "secret_token=<WEBHOOK_SECRET>"
  ```

Thread state type: `{ pendingUserId?: number; pendingUserLabel?: string }` — used for the admin reply-to-user flow.

### Database

Drizzle ORM with PostgreSQL (Neon). Schema at `lib/db/schema.ts`, config at `drizzle.config.ts`, migrations output to `./drizzle/`. Tables: `users`, `products`, `orders`, `order_items`, `messages`, `suggestions`, `announcements`.

Order status lifecycle: `pending` → `awaiting_payment` → `paid` → `processing` → `shipped` → `delivered` (or `cancelled`).

The `messages` table tracks user↔admin relay conversations (direction: `user_to_admin` | `admin_to_user`).

The `announcements` table stores broadcast-channel news posts (`source: 'admin_panel' | 'bot_command'`, plus `channelMessageId`, `sentAt`, `deletedAt`, `errorMessage`). Products also have `channelMessageId` / `channelPostedAt` columns to track whether they're currently posted to the broadcast channel.

### State Management

Cart is Zustand (`lib/cart-store.ts`) persisted to `localStorage`. No server-side session — user identity comes exclusively from Telegram WebApp `initData` parsed on the client (`lib/telegram.ts`) and passed via request headers to API routes.

### Admin

`/admin` is a client-side dashboard protected by `lib/admin-auth.ts` (checks `ADMIN_CHAT_IDS`). It manages products, orders, suggestions, and the broadcast channel via `/api/admin/*` routes. There is no server-side middleware guarding `/admin` — protection is API-side only (each `/api/admin/*` route calls `verifyAdmin()`). Tab components live in `app/admin/_components/` (`admin-stats.tsx`, `admin-products.tsx`, `admin-orders.tsx`, `admin-users.tsx`, `admin-dialogs.tsx`, `admin-suggestions.tsx`, `admin-broadcast.tsx`) and all receive `authHeaders` + `onUnauthorized` props from `app/admin/page.tsx`.

`admin-dialogs.tsx` is the admin-side UI for the user↔admin relay. It reads `/api/admin/dialogs` (list of conversations) and `/api/admin/dialogs/[userId]` (single thread). Sending a reply from the UI reuses the same bot flow as inline `reply_to:<id>` in `handlers.ts`.

`GET /api/admin/me` — lightweight endpoint that returns `{ isAdmin: true }` or 401. Used by `BottomNav` to conditionally show the admin tab (⚙️) for admin users. The check runs once on component mount.

### i18n

All UI strings go through `lib/i18n.ts`. To add a string: add a key to the `dict` constant with both `ru` and `en` values, then use `useT()` (React hook, client components) or `t(key, locale, params)` (non-reactive). The locale is detected from `window.Telegram.WebApp.initDataUnsafe.user.language_code` and set in the Zustand store by `TelegramInit` on mount. Supports `{placeholder}` interpolation in translation strings.

### Monetary Precision

All prices are stored as `numeric(18,6)` (USDT). The TRC20 monitor converts USDT to BigInt microsatoshis (`value * 1_000_000`) for comparison — never use floating-point arithmetic when matching payment amounts.

### TRC20 Address Pool

`lib/tron/pool.ts` auto-seeds the Redis set (`tron:pool:available`) from `TRON_DEPOSIT_ADDRESS_POOL` only when the set is **empty**. If the pool already has entries, adding addresses to the env var has no effect — use `redis.sadd('tron:pool:available', ...newAddresses)` directly.

### Redis Clients

A single `@upstash/redis` REST client (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) is used for everything:
- `lib/redis.ts` — product cache, TRC20 pool, bot locale, webhook health, rate limiting.
- Bot thread state (`lib/bot/index.ts`) — uses `createUpstashState()` from `lib/bot/upstash-state.ts`, a custom `StateAdapter` built on the same REST client. Replaces the former `@chat-adapter/state-redis` (ioredis/TCP), which hung on Vercel cold starts because port 6380 is unreachable from serverless. In dev without credentials, falls back to `createMemoryState()` (in-memory, non-persistent).

`UPSTASH_REDIS_URL` (`rediss://...`) is **no longer used**.

### Path Alias

`@/*` maps to the project root (configured in `tsconfig.json`). All internal imports use `@/lib/...`, `@/components/...`, etc.

### Stock & Rate Limiting Patterns

Order creation (`POST /api/orders`) uses two atomicity patterns:
- **Rate limiting**: Redis pipeline (`INCR` + `EXPIRE NX`) — atomic counter with TTL set only on first hit, prevents race where crash between INCR and EXPIRE leaves a permanent key.
- **Stock decrement**: DB transaction with `WHERE stock >= quantity` guard — if a concurrent order depleted stock, the update returns zero rows and the transaction rolls back.

### Telegram WebApp Initialization

`components/telegram-init.tsx` (rendered in root layout) calls `WebApp.ready()`, `WebApp.expand()`, and optionally `WebApp.requestFullscreen()` (guarded to Telegram client v7+). It also reads `language_code` from `initDataUnsafe` to set the i18n locale. The Telegram SDK script (`telegram-web-app.js`) is loaded with `strategy="beforeInteractive"` in the root layout.

**Back button**: `lib/use-telegram-nav.ts` exports `useTelegramBackButton()` — call it in any sub-page to wire Telegram's native BackButton to `router.back()`. Already used by cart, orders, suggest, and product detail pages. Always add it to new sub-pages.

### Security Headers (`next.config.ts`)

`X-Frame-Options` is intentionally **absent** — setting it would break Telegram's iframe embedding of the Mini App. The config sets `nosniff`, referrer policy, and permissions policy, but deliberately omits framing restrictions. Do not add `X-Frame-Options` or `frame-ancestors` CSP. `poweredByHeader: false` removes the `X-Powered-By: Next.js` header. `images.remotePatterns` allows any HTTPS hostname (product images can be hosted anywhere).

### GitHub Actions

Two workflows in `.github/workflows/`:
- `claude.yml` — triggers Claude Code on `@claude` mentions in issues, PRs, and review comments. Requires `CLAUDE_CODE_OAUTH_TOKEN` secret.
- `claude-code-review.yml` — automated code review on PRs.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username (used by Chat SDK, defaults to `shopbot`) |
| `ADMIN_CHAT_IDS` | Comma-separated admin Telegram user IDs |
| `ADMIN_CHANNEL_ID` | Optional Telegram channel for payment notifications |
| `BROADCAST_CHANNEL_ID` | Private channel ID for product drops and admin news (bot must be admin with Post/Edit/Delete). If unset, broadcast UI shows a warning and all helpers in `lib/bot/broadcast.ts` throw `BroadcastNotConfiguredError` — API routes return 503. |
| `MINI_APP_URL` | Deployed app URL (used in bot buttons) |
| `WEBHOOK_SECRET` | Secures the Telegram webhook endpoint (shared with Chat SDK adapter) |
| `TRON_DEPOSIT_ADDRESS_POOL` | Comma-separated TRC20 USDT deposit addresses |
| `TRON_USDT_CONTRACT` | TRC20 USDT contract (defaults to mainnet address) |
| `TRONGRID_API_KEY` | TronGrid API key |
| `TRONGRID_API_URL` | TronGrid base URL (optional, defaults to api.trongrid.io) |
| `PAYMENT_CONFIRMATIONS_REQUIRED` | TRC20 confirmations before marking paid (default 1) |
| `DATABASE_URL` | PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Redis REST client — address pool, product cache, bot state/locale |
| `CRON_SECRET` | Authenticates `/api/payments/verify` (sent as `Authorization: Bearer` by QStash) |
| `QSTASH_TOKEN` | Upstash QStash token — needed to create/manage the every-minute payment verify schedule |
| `ORDER_TTL_MINUTES` | Order expiry (default 30 min) |
| `NEXT_PUBLIC_ALLOW_DEV_AUTH` | Set `true` for dev auth bypass (dev only) |
| `NEXT_PUBLIC_DEV_TELEGRAM_USER_ID` | Synthetic user ID for dev auth bypass |
