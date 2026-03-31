# TG-Shop Deployment Guide

Telegram Mini App e-commerce store with USDT (TRC20) and TON crypto payments.

## Prerequisites

- Node.js 20+ (Node 24 LTS recommended)
- A Telegram bot (create via [@BotFather](https://t.me/BotFather))
- Neon PostgreSQL database ([neon.tech](https://neon.tech))
- Upstash Redis ([upstash.com](https://upstash.com))
- Vercel account ([vercel.com](https://vercel.com))
- TRC20 deposit addresses and/or a TON wallet

## 1. Create the Telegram Bot

```bash
# Talk to @BotFather:
/newbot
# Follow prompts, save the token

# Enable Mini App:
/setmenubutton
# Set URL to your Vercel domain (after deploy)
```

## 2. Set Up External Services

### Neon PostgreSQL
1. Create a new Neon project at [console.neon.tech](https://console.neon.tech)
2. Copy the connection string (`postgresql://...`)

### Upstash Redis
1. Create a Redis database at [console.upstash.com](https://console.upstash.com)
2. You need TWO sets of credentials:
   - **REST API**: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (for product cache, address pool, price cache)
   - **Connection URL**: `UPSTASH_REDIS_URL` (`rediss://default:token@endpoint:6379`) (for Chat SDK state adapter)

### TRC20 Deposit Addresses
Generate multiple TRC20 addresses (recommended: 5-10) and fund each with ~10 TRX for energy.
These are used as a pool — one address is assigned per order, then recycled after payment/expiry.

### TON Wallet (optional)
A single TON wallet that receives all TON payments. Orders are distinguished by a comment (`ORDER-{id}`).

## 3. Deploy to Vercel

### Option A: CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Link and deploy
cd tg-shop
vercel link
vercel env pull    # (if you added env vars in dashboard first)
vercel deploy      # preview deploy
vercel --prod      # production deploy
```

### Option B: Git Integration
1. Push the repo to GitHub
2. Import the project at [vercel.com/new](https://vercel.com/new)
3. Vercel auto-detects Next.js and deploys

## 4. Configure Environment Variables

In Vercel Dashboard > Project > Settings > Environment Variables, set:

### Required

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` |
| `ADMIN_CHAT_IDS` | Comma-separated admin Telegram IDs |
| `MINI_APP_URL` | Your Vercel URL (e.g. `https://tg-shop.vercel.app`) |
| `WEBHOOK_SECRET` | Random string (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token |
| `UPSTASH_REDIS_URL` | Upstash connection URL (`rediss://...`) |
| `CRON_SECRET` | Random string for cron auth |
| `TRON_DEPOSIT_ADDRESS_POOL` | Comma-separated TRC20 addresses |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_CHANNEL_ID` | — | Telegram channel for payment notifications |
| `TRON_USDT_CONTRACT` | Mainnet USDT | TRC20 contract address |
| `TRONGRID_API_KEY` | — | TronGrid API key (recommended) |
| `TON_WALLET_ADDRESS` | — | Required if accepting TON payments |
| `TONCENTER_API_KEY` | — | TonCenter API key |
| `ORDER_TTL_MINUTES` | 30 (TRC20) / 60 (TON) | Order expiry timeout |
| `PAYMENT_CONFIRMATIONS_REQUIRED` | 1 | TRC20 confirmations |

## 5. Initialize the Database

```bash
# Push schema to Neon
npx drizzle-kit push
```

Or from local:
```bash
DATABASE_URL="your-neon-url" npx drizzle-kit push
```

## 6. Register the Telegram Webhook

After your first production deploy, register the webhook:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<YOUR-DOMAIN>/api/telegram/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

Verify it's set:
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

## 7. Set Bot Menu Button

Tell BotFather to show your Mini App:

```
/setmenubutton
# Select your bot
# Send the URL: https://<YOUR-DOMAIN>
```

## 8. Verify Cron Job

The payment verification cron runs every minute (`/api/payments/verify`). It's configured in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/payments/verify", "schedule": "* * * * *" }]
}
```

Vercel automatically invokes this with `Authorization: Bearer <CRON_SECRET>`.

## Local Development

```bash
# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env

# Push DB schema
npx drizzle-kit push

# Start Next.js dev server
npm run dev

# In another terminal, start bot in polling mode (deletes webhook)
npx tsx bot-poll.ts
```

> **Note**: When switching between local polling and production webhook mode, you'll need to re-register the webhook (step 6) when going back to production.

## Architecture Overview

```
tg-shop/
├── app/                    # Next.js App Router
│   ├── api/
│   │   ├── admin/          # Admin API (initData + isAdmin auth)
│   │   ├── orders/         # User order API (initData auth)
│   │   ├── payments/verify # Cron: payment monitoring
│   │   ├── products/       # Public product catalog (cached)
│   │   ├── suggestions/    # User suggestions (initData auth)
│   │   └── telegram/webhook # Bot webhook endpoint
│   ├── admin/              # Admin dashboard
│   ├── cart/               # Shopping cart
│   ├── checkout/           # Payment page (TRC20 + TON)
│   ├── orders/             # User order history
│   ├── product/[id]/       # Product detail
│   └── suggest/            # Product suggestion form
├── components/             # React components
├── lib/
│   ├── bot/                # Chat SDK bot (handlers, notifications)
│   ├── db/                 # Drizzle ORM (schema, connection)
│   ├── ton/                # TON payment monitor + price feed
│   ├── tron/               # TRC20 payment monitor + address pool
│   ├── i18n.ts             # Bilingual support (ru/en)
│   ├── telegram-auth.ts    # initData HMAC verification
│   └── admin-auth.ts       # Admin verification
└── bot-poll.ts             # Local dev polling bot
```

## Payment Flow

1. User adds items to cart and clicks "Pay"
2. Backend creates order, acquires payment address (TRC20 pool or TON wallet)
3. User sees QR code + address on checkout page
4. User sends crypto and clicks "I've sent"
5. Order moves to `awaiting_payment`
6. Cron (`/api/payments/verify`) polls TronGrid/TonCenter every minute
7. On match: order -> `paid`, user notified via Telegram bot
8. Admin manages order status via bot or `/admin` dashboard

## Security

- All user API routes verify Telegram `initData` via HMAC-SHA256 (timing-safe)
- Admin routes verify initData + check against `ADMIN_CHAT_IDS`
- Webhook endpoint validates `secret_token` via Chat SDK adapter
- Cron endpoint validates `CRON_SECRET` bearer token
- No secrets in client code — all auth happens server-side
