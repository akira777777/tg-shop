/**
 * One-time bot setup: register commands, set menu button.
 * Run manually: npx tsx lib/bot/setup.ts
 */
import 'dotenv/config';

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const MINI_APP_URL = process.env.MINI_APP_URL ?? '';

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
    description: '🛍️ Магазин с оплатой через USDT (TRC20) и TON.\n\nОткройте каталог, выберите товар и оплатите криптовалютой.',
    language_code: 'ru',
  });

  await call('setMyShortDescription', {
    short_description: 'Магазин с оплатой через USDT и TON',
    language_code: 'ru',
  });

  // ── Bot description (English) ──
  await call('setMyDescription', {
    description: '🛍️ Shop with USDT (TRC20) and TON payments.\n\nBrowse the catalog, pick a product, and pay with crypto.',
    language_code: 'en',
  });

  await call('setMyShortDescription', {
    short_description: 'Crypto shop — USDT & TON payments',
    language_code: 'en',
  });

  console.log('\n🎉 Bot setup complete!');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
