/**
 * One-time bot setup: register commands, set menu button.
 * Run manually: npx tsx lib/bot/setup.ts
 */
import 'dotenv/config';

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const MINI_APP_URL = process.env.MINI_APP_URL ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

async function call(method: string, body: object) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method} failed: ${JSON.stringify(data)}`);
  console.log(`✅ ${method}`);
  return data;
}

async function main() {
  // ── Admin-scoped commands (per chat_id) — shows /news in admins' menus only ──
  const adminIds = (process.env.ADMIN_CHAT_IDS ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));

  for (const adminId of adminIds) {
    await call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Панель администратора' },
        { command: 'orders', description: 'Все заказы' },
        { command: 'status', description: 'Детали заказа — /status <номер>' },
        { command: 'news', description: '📣 Новость в канал' },
        { command: 'cancel', description: 'Отменить текущее действие' },
        { command: 'help', description: 'Помощь' },
      ],
      scope: { type: 'chat', chat_id: adminId },
    });
  }

  // ── Bot commands (Russian) ──
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Запустить бота / Главное меню' },
      { command: 'status', description: 'Статус заказа — /status <номер>' },
      { command: 'orders', description: 'Мои заказы' },
      { command: 'help', description: 'Помощь' },
    ],
    language_code: 'ru',
  });

  // ── Bot commands (English) ──
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Launch bot / Main menu' },
      { command: 'status', description: 'Order status — /status <id>' },
      { command: 'orders', description: 'My orders' },
      { command: 'help', description: 'Help' },
    ],
    language_code: 'en',
  });

  // ── Default commands (fallback) ──
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Start / Main menu' },
      { command: 'status', description: 'Order status — /status <id>' },
      { command: 'orders', description: 'My orders' },
      { command: 'help', description: 'Help' },
    ],
  });

  // ── Menu button → opens Mini App ──
  if (MINI_APP_URL) {
    await call('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '🛍️ Магазин',
        web_app: { url: MINI_APP_URL },
      },
    });
  } else {
    console.warn('⚠️ MINI_APP_URL not set — skipping menu button');
  }

  // ── Bot description (Russian) ──
  await call('setMyDescription', {
    description: '🛍️ Магазин с оплатой через USDT (TRC20).\n\nОткройте каталог, выберите товар и оплатите криптовалютой.',
    language_code: 'ru',
  });

  await call('setMyShortDescription', {
    short_description: 'Магазин с оплатой через USDT (TRC20)',
    language_code: 'ru',
  });

  // ── Bot description (English) ──
  await call('setMyDescription', {
    description: '🛍️ Shop with USDT (TRC20) payments.\n\nBrowse the catalog, pick a product, and pay with crypto.',
    language_code: 'en',
  });

  await call('setMyShortDescription', {
    short_description: 'Crypto shop — USDT (TRC20) payments',
    language_code: 'en',
  });

  // ── Webhook registration ──
  if (MINI_APP_URL) {
    // MINI_APP_URL typically points at the site root, e.g. https://tg-shop.vercel.app/
    const base = MINI_APP_URL.replace(/\/$/, '');
    const webhookUrl = `${base}/api/telegram/webhook`;
    await call('setWebhook', {
      url: webhookUrl,
      ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
      drop_pending_updates: false,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    });
    console.log(`   → webhook set to ${webhookUrl}`);

    const info = await call('getWebhookInfo', {});
    console.log('   → webhook info:', JSON.stringify(info.result, null, 2));
  } else {
    console.warn('⚠️ MINI_APP_URL not set — skipping webhook registration');
  }

  console.log('\n🎉 Bot setup complete! The bot is live and will handle updates via webhook.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
