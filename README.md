# tg-shop — Telegram Mini App магазин

Next.js 16 + React 19 Telegram Mini App со своим Telegram-ботом, админ-панелью и оплатой USDT (TRC20). Развёрнут на Vercel, данные — Postgres (Neon) + Redis (Upstash).

## Содержание
- [Возможности](#возможности)
- [Стек](#стек)
- [Быстрый старт](#быстрый-старт)
- [Переменные окружения](#переменные-окружения)
- [Деплой на Vercel](#деплой-на-vercel)
- [Регистрация бота в Telegram](#регистрация-бота-в-telegram)
- [Cron: проверка платежей и поддержка вебхука](#cron-проверка-платежей-и-поддержка-вебхука)
- [Использование бота](#использование-бота)
- [Админ-панель](#админ-панель)
- [Канал новостей (broadcast)](#канал-новостей-broadcast)
- [Локализация](#локализация)
- [Архитектура](#архитектура)
- [FAQ / Troubleshooting](#faq--troubleshooting)

---

## Возможности

- 🛍️ **Каталог и корзина** внутри Telegram Mini App
- 💵 **Оплата USDT (TRC20)** с пулом депозит-адресов (резервирование per-order через Redis)
- 🤖 **Telegram-бот**: команды `/start`, `/orders`, `/status`, `/help`, диалоги с менеджером, уведомления о статусе заказа
- 🌐 **Автоматическая локализация бота**: русский для пользователей с `language_code=ru`, английский — для остальных
- 👑 **Админ-панель** в Mini App:
  - 📊 **Обзор** — выручка (всего / 30 д / 7 д), топ-5 товаров, счётчики, разбивка по статусам
  - 📦 **Заказы** — фильтр по статусу, смена статуса
  - 🛍️ **Товары** — CRUD, публикация в канал одной кнопкой
  - 📣 **Канал** — публикация новостей в приватный канал магазина + история постов
  - 👥 **Юзеры** — поиск по имени/@username/ID, сумма трат
  - 💬 **Диалоги** — полная история переписки, отправка ответов
  - 💡 **Идеи** — предложения от пользователей
- 📢 **Broadcast-канал** — автопубликация новинок и ручных анонсов в приватный Telegram-канал; команда `/news` в боте для быстрых постов с телефона
- 🔄 **Самовосстановление вебхука** — каждую минуту cron проверяет регистрацию и переустанавливает её при ошибке
- ⏰ **Автопросрочка заказов** и возврат TRC20-адресов в пул

## Стек

| Слой | Технология |
|---|---|
| Framework | **Next.js 16** (App Router) + React 19 |
| UI | Tailwind v4, `@base-ui/react`, кастомные компоненты в `components/ui/` |
| Бот | `chat` SDK + `@chat-adapter/telegram` + raw Bot API fallback (`lib/bot/telegram-api.ts`) |
| Auth | HMAC-SHA256 `initData` Telegram WebApp (`lib/telegram-auth.ts`) |
| DB | PostgreSQL (Neon) через Drizzle ORM |
| Cache | Upstash Redis (REST) |
| Cron | Upstash QStash (schedule → POST `/api/payments/verify`) |
| Hosting | Vercel (pnpm, Turbopack) |

---

## Быстрый старт

**Требования:** Node.js 20+, pnpm, аккаунты Vercel / Neon / Upstash, Telegram-бот от [@BotFather](https://t.me/BotFather).

```bash
# Клон и зависимости
git clone https://github.com/akira777777/tg-shop.git
cd tg-shop
pnpm install

# Заполнить переменные окружения
cp .env.example .env.local   # затем отредактировать
# или: vercel env pull .env.local (если проект уже привязан)

# Миграции
DATABASE_URL='postgresql://...' pnpm run db:push

# Локальная разработка (Mini App)
pnpm run dev                # http://localhost:3000

# Локальная разработка бота в polling-режиме
#  ⚠️ удаляет production webhook — после работы восстановить через setup.ts
pnpm run bot:poll
```

Для работы в браузере без Telegram (отладка) поставьте в `.env.local`:
```
NEXT_PUBLIC_ALLOW_DEV_AUTH=true
NEXT_PUBLIC_DEV_TELEGRAM_USER_ID=<ваш telegram id>
```

---

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `TELEGRAM_BOT_USERNAME` | Username бота (без @), используется Chat SDK |
| `ADMIN_CHAT_IDS` | Telegram ID админов через запятую |
| `ADMIN_CHANNEL_ID` | (опц.) канал для уведомлений админам об оплатах |
| `BROADCAST_CHANNEL_ID` | (опц.) приватный канал для публикации новостей и новинок подписчикам — см. [Канал новостей](#канал-новостей-broadcast) |
| `MINI_APP_URL` | URL деплоя (`https://your-app.vercel.app/`) — основа для webhook и кнопок |
| `WEBHOOK_SECRET` | Секрет Telegram webhook |
| `TRON_DEPOSIT_ADDRESS_POOL` | Адреса TRC20 USDT через запятую |
| `TRON_USDT_CONTRACT` | Контракт USDT (по умолчанию mainnet) |
| `TRONGRID_API_KEY` | Ключ TronGrid (опц., повышает лимиты) |
| `TRONGRID_API_URL` | Базовый URL TronGrid (опц.) |
| `PAYMENT_CONFIRMATIONS_REQUIRED` | Сколько подтверждений TRC20 (по умолчанию 1) |
| `DATABASE_URL` | Строка подключения Postgres (Neon) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Upstash Redis REST-клиент |
| `CRON_SECRET` | Секрет для аутентификации cron-запросов от QStash |
| `QSTASH_TOKEN` | Токен Upstash QStash (для управления расписанием) |
| `ORDER_TTL_MINUTES` | Жизнь awaiting_payment заказа (по умолчанию 30) |
| `NEXT_PUBLIC_ALLOW_DEV_AUTH` | `true` для dev bypass (не использовать в проде) |
| `NEXT_PUBLIC_DEV_TELEGRAM_USER_ID` | Синтетический ID для dev bypass |

---

## Деплой на Vercel

1. **Импортировать репо** в Vercel, выбрать pnpm.
2. Заполнить все переменные окружения из таблицы выше в Vercel → Settings → Environment Variables.
3. **Применить схему БД:**
   ```bash
   DATABASE_URL='postgresql://...' pnpm run db:push
   ```
4. **Первый деплой** через `git push` — Vercel соберёт и опубликует.
5. **Проинициализировать бота** (команды, меню, webhook) один раз:
   ```bash
   npx tsx lib/bot/setup.ts
   ```
   Этот же скрипт регистрирует webhook и может запускаться повторно после смены домена.
6. **Настроить QStash** (см. следующую секцию).

---

## Регистрация бота в Telegram

1. [@BotFather](https://t.me/BotFather) → `/newbot` → получить токен → внести в `TELEGRAM_BOT_TOKEN`.
2. `/setdomain` → ваш домен (для Mini App авторизации).
3. Прогнать `npx tsx lib/bot/setup.ts` — он:
   - Зарегистрирует команды на ru/en
   - Установит menu button "🛍️ Магазин" с web_app URL из `MINI_APP_URL`
   - Поставит описание бота
   - **Зарегистрирует webhook** `MINI_APP_URL/api/telegram/webhook` с `WEBHOOK_SECRET`
   - Выведет `getWebhookInfo` для проверки

Проверить вручную:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## Cron: проверка платежей и поддержка вебхука

Каждую минуту `POST /api/payments/verify` должен вызываться внешним планировщиком (Vercel Hobby не даёт минутные cron — используем **Upstash QStash**).

Настройка через Upstash Console:
- **Destination:** `https://<ваш домен>/api/payments/verify`
- **Schedule:** `* * * * *` (каждую минуту)
- **Headers:** `Authorization: Bearer <CRON_SECRET>`

Что он делает:
1. **Проверяет TRC20 платежи** — просрочки / новые подтверждённые транзакции на адресах из пула
2. **Самовосстановление вебхука** (`ensureWebhook()`) — проверяет, что `getWebhookInfo.url` совпадает с `MINI_APP_URL/api/telegram/webhook` и нет последних ошибок; если нет — переустанавливает. Кешируется в Redis на 5 минут, чтобы не флудить API Telegram.
3. **Keep-warm** — сам по себе минутный вызов не даёт функции полностью замёрзнуть, что уменьшает latency на первый webhook-апдейт после простоя.

---

## Использование бота

### Команды

- `/start` — главное меню (каталог, мои заказы, написать менеджеру, предложить товар)
- `/orders` — последние 5 заказов
- `/status <номер>` — детали заказа
- `/help` — справка
- `/news` *(только для админов)* — опубликовать новость в канал: бот попросит текст, покажет предпросмотр, пришлёт ссылку на созданный пост
- `/cancel` *(только для админов)* — отменить текущее действие (отправку ответа пользователю или подготовку новости)

### Flow покупателя
1. Открыть бота → `/start` → «🛍️ Открыть каталог» → Mini App
2. Добавить товар → Корзина → Оформить заказ
3. Бот присылает адрес TRC20 USDT и сумму → скопировать, оплатить с любого кошелька
4. Автопроверка подтверждает транзакцию → бот уведомляет → админ видит заказ в панели
5. Статус меняется: `awaiting_payment` → `paid` → `processing` → `shipped` → `delivered`

### Flow связи с менеджером
- Пользователь: жмёт «💬 Написать менеджеру» в боте или пишет любое сообщение
- Админы получают пересланное сообщение с кнопкой «💬 Ответить»
- Админ нажимает «Ответить» → пишет текст → пользователь получает анонимный ответ от имени бота
- Вся переписка видна в админ-панели → вкладка 💬 Диалоги

---

## Админ-панель

Путь: `<MINI_APP_URL>/admin`. Доступ — только если ваш Telegram ID есть в `ADMIN_CHAT_IDS`.

**Вкладки:**

- 📊 **Обзор** — выручка всего/30д/7д, заказы сегодня, счётчики (юзеры, товары активные/всего, низкий сток, сообщения, идеи), разбивка по статусам, топ-5 товаров.
- 📦 **Заказы** — фильтр по статусу, бесконечная прокрутка, смена статуса с автоуведомлением.
- 🛍️ **Товары** — CRUD: имя, описание, цена USDT, категория, изображение, сток, active.
- 📣 **Канал** — публикация новостей в приватный канал магазина и история постов; см. [Канал новостей (broadcast)](#канал-новостей-broadcast).
- 👥 **Юзеры** — поиск по имени/@username/ID, кол-во заказов, сумма трат, дата последнего заказа.
- 💬 **Диалоги** — список бесед по дате, полная история, отправка анонимного ответа на языке пользователя.
- 💡 **Идеи** — предложения товаров от пользователей.

---

## Канал новостей (broadcast)

Бот умеет постить в **ваш приватный Telegram-канал** две вещи:

- **Новости** — произвольные объявления от админа (веб-форма или команда бота).
- **Новинки каталога** — вручную, кнопкой «📣 Опубликовать» в админке на каждой карточке товара.

При деактивации товара (снятие с продажи / обнуление стока) уже опубликованный пост автоматически редактируется на «❌ Снят с продажи», чтобы лента канала оставалась чистой.

### Настройка канала

1. Создайте приватный канал в Telegram (Settings → New Channel → Private).
2. Добавьте своего бота в администраторы канала с правами:
   - **Post Messages** — обязательно.
   - **Edit Messages** — нужно для авто-правки при деактивации товара.
   - **Delete Messages** — нужно, чтобы кнопка «🗑️ Удалить» в истории новостей стирала пост из канала.
3. Получите `chat_id` канала:
   - Перешлите любое сообщение из канала в [@getidsbot](https://t.me/getidsbot) или используйте `getChat` через Bot API.
   - ID канала начинается с `-100…`.
4. Добавьте переменную окружения: `BROADCAST_CHANNEL_ID=-100…`
5. Перезапустите деплой (или локальный `npm run dev`).

### Как отправлять новости

- **Из админ-панели**: вкладка **📣 Канал** → введите текст → «Отправить». История всех постов со статусами и кнопкой «Удалить» — там же.
- **Из Telegram** (для админов): команда `/news` → бот попросит текст → покажет предпросмотр → подтверждение. Удобно с телефона.
- Поддерживается HTML: `<b>`, `<i>`, `<a href="…">`, `<code>`.

### Ограничения Telegram

- Бот не может удалить сообщение старше **48 часов** в группах/каналах (ограничение Bot API). Такие записи в истории помечаются как «удалено», но остаются видны в канале.
- Telegram: не более **~30 сообщений/сек** суммарно и **~20/мин в один чат** — массовые публикации товаров стоит разносить во времени.

---

## Локализация

- **Mini App** (`lib/i18n.ts`) — ru / en через Zustand store, определяется по `window.Telegram.WebApp.initDataUnsafe.user.language_code`.
- **Бот** (`lib/bot/user-lang.ts`) — автоматически определяет язык из `update.message.from.language_code`, кеширует в Redis (`user_lang:<id>`), и выбирает `ru` если язык русский, `en` во всех остальных случаях. При открытии Mini App клиент отдельно шлёт `POST /api/user/lang` чтобы закешировать язык даже если юзер ещё не писал боту.
- Админ-сообщения всегда на русском.

---

## Архитектура

```
┌─────────────────────────┐
│   Telegram клиент       │
│   (Mini App + бот)      │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐      ┌────────────────────┐
│   Vercel (Next.js 16)   │◄────►│  Neon (Postgres)   │
│   ├─ /api/orders        │      │  Drizzle ORM       │
│   ├─ /api/admin/*       │      └────────────────────┘
│   ├─ /api/telegram/wh   │
│   ├─ /api/payments/vfy  │      ┌────────────────────┐
│   └─ app/admin/*        │◄────►│  Upstash Redis     │
└──────────┬──────────────┘      │  (REST: cache,     │
           │                     │   pool, rate limit,│
           ▼                     │   bot state)       │
┌─────────────────────────┐      └────────────────────┘
│ Upstash QStash cron     │
│ (every 1 min → verify)  │
└─────────────────────────┘
```

**Ключевые модули:**
- `app/api/telegram/webhook/route.ts` — принимает Telegram updates, кеширует `language_code` из сырого payload, форвардит в Chat SDK
- `lib/bot/handlers.ts` — все команды и действия бота (dispatchCommand, relayToAdmins, pending-reply flow, cancelOrder, admin actions)
- `lib/bot/ensure-webhook.ts` — самовосстановление webhook
- `lib/bot/user-lang.ts` — локаль и словарь бота
- `lib/tron/monitor.ts` — проверка TRC20 транзакций, автоподтверждение оплат, просрочка
- `lib/tron/pool.ts` — резервирование/возврат адресов в Redis-сете
- `lib/db/schema.ts` — Drizzle схема (users, products, orders, order_items, messages, suggestions)

---

## FAQ / Troubleshooting

**Q: Бот не отвечает.**
A: Проверьте `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`. Если `url` пустой, запустите `npx tsx lib/bot/setup.ts` или дождитесь следующего cron-тика — `ensureWebhook` переустановит автоматически.

**Q: Оплата не подтверждается.**
A: Убедитесь что QStash schedule включён и вызывает `/api/payments/verify` с правильным `CRON_SECRET`. Проверьте логи функции на Vercel.

**Q: Пользователь получил сообщение на английском хотя он русский.**
A: Redis-ключ `user_lang:<id>` мог закешироваться раньше (до выставления `language_code`). Удалите его через Upstash console или подождите — при первом сообщении боту он перезапишется.

**Q: `db:push` ругается на отсутствие `DATABASE_URL`.**
A: drizzle-kit не читает `.env.local`. Передавайте явно: `DATABASE_URL='postgresql://...' pnpm run db:push`.

**Q: Я запустил `pnpm run bot:poll` и теперь бот в production не отвечает.**
A: Polling режим удаляет webhook. Запустите `npx tsx lib/bot/setup.ts` чтобы вернуть его.

**Q: Какие команды есть?**
```bash
pnpm run dev          # Mini App dev server
pnpm run build        # production build
pnpm run lint         # eslint
pnpm run bot:poll     # локальный polling-бот (⚠️ сносит production webhook)
pnpm run db:push      # применить Drizzle-схему к Postgres
pnpm run db:studio    # Drizzle Studio GUI
npx tsx lib/bot/setup.ts  # настройка бота в Telegram (команды, меню, webhook)
```
