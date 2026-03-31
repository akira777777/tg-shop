'use client';

import { create } from 'zustand';

export type Locale = 'ru' | 'en';

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocale = create<LocaleStore>((set) => ({
  locale: 'ru',
  setLocale: (locale) => set({ locale }),
}));

/** Detect locale from Telegram WebApp language_code */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'ru';
  const lang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  return lang?.startsWith('en') ? 'en' : 'ru';
}

// ── Translation dictionary ──────────────────────────────────────────────────

const dict = {
  // Catalog
  'catalog.title': { ru: '🛍️ Каталог', en: '🛍️ Catalog' },
  'catalog.search': { ru: 'Поиск товаров…', en: 'Search products…' },
  'catalog.empty': { ru: 'Здесь пока нет товаров.', en: 'No products here yet.' },
  'catalog.addToCart': { ru: 'В корзину', en: 'Add to cart' },
  'catalog.outOfStock': { ru: 'Нет в наличии', en: 'Out of stock' },
  'catalog.inStock': { ru: 'В наличии: {count}', en: '{count} in stock' },
  'catalog.all': { ru: 'Все', en: 'All' },

  // Product
  'product.addToCart': { ru: 'В корзину — ${price} USDT', en: 'Add to cart — ${price} USDT' },
  'product.viewCart': { ru: 'Перейти в корзину ({count} добавлено)', en: 'View cart ({count} added)' },
  'product.notFound': { ru: 'Товар не найден.', en: 'Product not found.' },
  'product.back': { ru: '← Назад', en: '← Back' },

  // Cart
  'cart.title': { ru: 'Корзина', en: 'Your Cart' },
  'cart.empty': { ru: 'Корзина пуста.', en: 'Your cart is empty.' },
  'cart.browseCatalog': { ru: 'Посмотреть каталог', en: 'Browse catalog' },
  'cart.total': { ru: 'Итого', en: 'Total' },
  'cart.each': { ru: 'за шт.', en: 'each' },
  'cart.payTrc20': { ru: 'Оплатить USDT (TRC20)', en: 'Pay with USDT (TRC20)' },
  'cart.payTon': { ru: 'Оплатить TON', en: 'Pay with TON' },
  'cart.payWith': { ru: 'Оплатить', en: 'Pay with' },
  'cart.creating': { ru: 'Создание заказа…', en: 'Creating order…' },
  'cart.openInTelegram': { ru: 'Откройте в Telegram для оформления.', en: 'Open this in Telegram to checkout.' },
  'cart.networkError': { ru: 'Ошибка сети. Попробуйте ещё раз.', en: 'Network error. Please try again.' },

  // Checkout
  'checkout.title': { ru: '💳 Оплата', en: '💳 Payment' },
  'checkout.order': { ru: 'Заказ', en: 'Order' },
  'checkout.amount': { ru: 'Сумма к оплате', en: 'Amount to send' },
  'checkout.usdtEquiv': { ru: 'Эквивалент USDT', en: 'USDT equivalent' },
  'checkout.network': { ru: 'Сеть', en: 'Network' },
  'checkout.copyAddress': { ru: 'Копировать адрес', en: 'Copy address' },
  'checkout.copied': { ru: '✓ Скопировано!', en: '✓ Copied!' },
  'checkout.commentRequired': { ru: '💬 Обязательно укажите этот комментарий в переводе:', en: '💬 You MUST include this comment in your transfer:' },
  'checkout.commentWarning': { ru: 'Без этого комментария платёж не будет привязан к заказу.', en: 'Without this comment, your payment cannot be matched to your order.' },
  'checkout.warningTrc20': { ru: '⚠️ Отправьте ровно {amount} USDT в сети Tron (TRC20) на указанный адрес. Отправка других токенов или в другой сети приведёт к потере средств.', en: '⚠️ Send exactly {amount} USDT on the Tron (TRC20) network to this address. Sending other tokens or on a different network will result in permanent loss.' },
  'checkout.warningTon': { ru: '⚠️ Отправьте ровно {amount} TON на указанный адрес в сети TON с комментарием выше. Отправка без комментария приведёт к потере платежа.', en: '⚠️ Send exactly {amount} TON to this address on the TON network with the comment above. Sending without the comment will result in a lost payment.' },
  'checkout.confirmBtn': { ru: 'Я отправил(а) платёж', en: "I've sent the payment" },
  'checkout.confirming': { ru: 'Подтверждение…', en: 'Confirming…' },
  'checkout.autoVerify': { ru: 'Мы проверим автоматически. Это запускает мониторинг.', en: "We'll verify automatically. This just starts the watch." },
  'checkout.waiting': { ru: 'Ожидание подтверждения', en: 'Waiting for confirmation' },
  'checkout.waitingDesc': { ru: 'Мы уведомим вас в Telegram, когда обнаружим платёж. Обычно это занимает 1–3 минуты.', en: "We'll notify you in Telegram once we detect your payment. This usually takes 1–3 minutes." },
  'checkout.viewOrders': { ru: 'Мои заказы', en: 'View my orders' },
  'checkout.invalid': { ru: 'Недействительная сессия оплаты.', en: 'Invalid checkout session.' },

  // Orders
  'orders.title': { ru: 'Мои заказы', en: 'My Orders' },
  'orders.empty': { ru: 'Заказов пока нет.', en: 'No orders yet.' },
  'orders.startShopping': { ru: 'За покупками', en: 'Start shopping' },
  'orders.showPayment': { ru: 'Показать адрес оплаты', en: 'Show payment address' },
  'orders.openInTelegram': { ru: 'Откройте в Telegram для просмотра заказов.', en: 'Open this in Telegram to see your orders.' },

  // Suggest
  'suggest.title': { ru: '💡 Предложить товар', en: '💡 Suggest a Product' },
  'suggest.nameLabel': { ru: 'Название товара *', en: 'Product name *' },
  'suggest.namePlaceholder': { ru: 'Например: Беспроводные наушники', en: 'e.g. Wireless headphones' },
  'suggest.descLabel': { ru: 'Описание', en: 'Description' },
  'suggest.descLabelOptional': { ru: '(необязательно)', en: '(optional)' },
  'suggest.descPlaceholder': { ru: 'Расскажите, почему хотите этот товар…', en: "Tell us more about why you'd like this product…" },
  'suggest.submit': { ru: 'Отправить предложение', en: 'Submit Suggestion' },
  'suggest.submitting': { ru: 'Отправка…', en: 'Submitting…' },
  'suggest.thanksTitle': { ru: 'Спасибо!', en: 'Thank you!' },
  'suggest.thanksDesc': { ru: 'Ваше предложение получено. Мы рассмотрим его в ближайшее время.', en: "Your suggestion has been received. We'll review it soon." },
  'suggest.backToCatalog': { ru: 'Вернуться в каталог', en: 'Back to catalog' },
  'suggest.openInTelegram': { ru: 'Откройте в Telegram для отправки предложения.', en: 'Open this in Telegram to submit a suggestion.' },
  'suggest.networkError': { ru: 'Ошибка сети. Попробуйте ещё раз.', en: 'Network error. Please try again.' },

  // Nav
  'nav.catalog': { ru: 'Каталог', en: 'Catalog' },
  'nav.cart': { ru: 'Корзина', en: 'Cart' },
  'nav.orders': { ru: 'Заказы', en: 'Orders' },
  'nav.idea': { ru: 'Идея', en: 'Idea' },

  // Status labels
  'status.pending': { ru: '🕐 Ожидание', en: '🕐 Pending' },
  'status.awaiting_payment': { ru: '💳 Ожидание оплаты', en: '💳 Awaiting Payment' },
  'status.paid': { ru: '✅ Оплачен', en: '✅ Paid' },
  'status.processing': { ru: '⚙️ В обработке', en: '⚙️ Processing' },
  'status.shipped': { ru: '🚚 Отправлен', en: '🚚 Shipped' },
  'status.delivered': { ru: '📦 Доставлен', en: '📦 Delivered' },
  'status.cancelled': { ru: '❌ Отменён', en: '❌ Cancelled' },

  // Loading
  'loading': { ru: 'Загрузка…', en: 'Loading…' },
  'loading.catalog': { ru: 'Загрузка каталога…', en: 'Loading catalog…' },
  'loading.orders': { ru: 'Загрузка заказов…', en: 'Loading orders…' },
} as const;

export type TranslationKey = keyof typeof dict;

/**
 * Returns translated string. Supports {placeholder} replacement.
 */
export function t(key: TranslationKey, locale: Locale, params?: Record<string, string | number>): string {
  const entry = dict[key];
  let text: string = entry?.[locale] ?? entry?.['ru'] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * React hook that returns a bound `t()` for the current locale.
 */
export function useT() {
  const locale = useLocale((s) => s.locale);
  return (key: TranslationKey, params?: Record<string, string | number>) => t(key, locale, params);
}
