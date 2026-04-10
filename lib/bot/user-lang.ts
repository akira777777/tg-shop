import { redis } from '@/lib/redis';

export type BotLocale = 'ru' | 'en';

const langKey = (userId: number | string) => `user_lang:${userId}`;

/** Cache a user's preferred bot locale (derived from Telegram language_code). */
export async function setUserLocale(userId: number, code: string | undefined): Promise<void> {
  const locale: BotLocale = code?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  await redis.set(langKey(userId), locale).catch(() => {});
}

/** Fetch a user's preferred locale. Defaults to English if not cached. */
export async function getUserLocale(userId: number | string): Promise<BotLocale> {
  const raw = await redis.get<string>(langKey(userId)).catch(() => null);
  return raw === 'ru' ? 'ru' : 'en';
}

// ── Minimal bot translation dictionary ─────────────────────────────────────

type Dict = Record<string, { ru: string; en: string }>;

const dict: Dict = {
  'welcome.title': {
    ru: 'Добро пожаловать в наш магазин! 🛒\n\nПросматривайте каталог и оплачивайте заказы через USDT.',
    en: 'Welcome to our store! 🛒\n\nBrowse the catalog and pay for orders with USDT.',
  },
  'btn.catalog':     { ru: '🛍️ Открыть каталог',     en: '🛍️ Open catalog' },
  'btn.my_orders':   { ru: '📋 Мои заказы',          en: '📋 My orders' },
  'btn.contact_mgr': { ru: '💬 Написать менеджеру',  en: '💬 Contact manager' },
  'btn.suggest':     { ru: '💡 Предложить товар',    en: '💡 Suggest a product' },
  'btn.all_orders':  { ru: '📋 Все заказы',          en: '📋 All orders' },

  'contact.intro': {
    ru: '💬 Просто напишите сообщение, и менеджер ответит вам в ближайшее время.\n\nВаши данные остаются конфиденциальными.',
    en: '💬 Just send a message and a manager will reply shortly.\n\nYour data remains confidential.',
  },
  'contact.sent': {
    ru: '✅ Ваше сообщение отправлено менеджеру. Ожидайте ответа.',
    en: '✅ Your message was sent to the manager. Please wait for a reply.',
  },
  'contact.sent_short': {
    ru: '✅ Ваше сообщение отправлено менеджеру.',
    en: '✅ Your message was sent to the manager.',
  },

  'reply.prefix': {
    ru: '💬 <b>Ответ менеджера:</b>',
    en: '💬 <b>Manager reply:</b>',
  },

  'orders.none': {
    ru: '📭 У вас пока нет заказов.',
    en: '📭 You have no orders yet.',
  },
  'orders.list_title': {
    ru: '📦 <b>Ваши последние заказы:</b>',
    en: '📦 <b>Your recent orders:</b>',
  },
  'orders.status_hint': {
    ru: 'Используйте /status &lt;номер&gt; для деталей.',
    en: 'Use /status &lt;id&gt; for details.',
  },
  'orders.status_usage': {
    ru: 'Использование: /status <номер_заказа>',
    en: 'Usage: /status <order_id>',
  },
  'orders.not_found': {
    ru: 'Заказ не найден.',
    en: 'Order not found.',
  },

  'help.user': {
    ru:
      'ℹ️ <b>Как пользоваться магазином:</b>\n\n' +
      '🛍️ Нажмите <b>Меню</b> внизу чата → откроется каталог\n' +
      '🛒 Добавьте товары в корзину → оформите заказ\n' +
      '💳 Оплатите USDT (TRC20)\n' +
      '⏳ Бот уведомит вас, когда оплата подтверждена\n\n' +
      '<b>Команды:</b>\n' +
      '/start — Главное меню\n' +
      '/orders — Мои заказы\n' +
      '/status &lt;номер&gt; — Статус заказа\n' +
      '/cancel &lt;номер&gt; — Отменить заказ\n' +
      '/help — Помощь\n\n' +
      '💬 Для связи с менеджером — просто напишите сообщение.',
    en:
      'ℹ️ <b>How to use the store:</b>\n\n' +
      '🛍️ Tap <b>Menu</b> at the bottom of the chat → open catalog\n' +
      '🛒 Add items to cart → place an order\n' +
      '💳 Pay in USDT (TRC20)\n' +
      '⏳ The bot will notify you once payment is confirmed\n\n' +
      '<b>Commands:</b>\n' +
      '/start — Main menu\n' +
      '/orders — My orders\n' +
      '/status &lt;id&gt; — Order status\n' +
      '/cancel &lt;id&gt; — Cancel an order\n' +
      '/help — Help\n\n' +
      '💬 To contact a manager — just send a message.',
  },

  'cancel.usage': {
    ru: 'Использование: /cancel &lt;номер_заказа&gt;',
    en: 'Usage: /cancel &lt;order_id&gt;',
  },
  'cancel.not_found': {
    ru: 'Заказ не найден или уже отменён.',
    en: 'Order not found or already cancelled.',
  },
  'cancel.success': {
    ru: '✅ Заказ #{id} отменён.',
    en: '✅ Order #{id} cancelled.',
  },
  'cancel.not_allowed': {
    ru: 'Заказ нельзя отменить (статус: {status}).',
    en: 'Order cannot be cancelled (status: {status}).',
  },
};

export function tr(key: keyof typeof dict, locale: BotLocale, params?: Record<string, string>): string {
  let str = dict[key][locale] ?? dict[key].en;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, v);
    }
  }
  return str;
}
