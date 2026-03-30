import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';
import { orders, orderItems, products, users, messages } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { ADMIN_IDS } from './relay';

const MINI_APP_URL = process.env.TELEGRAM_MINI_APP_URL!;

const STATUS_EMOJI: Record<string, string> = {
  pending: '🕐',
  awaiting_payment: '💳',
  paid: '✅',
  processing: '⚙️',
  shipped: '🚚',
  delivered: '📦',
  cancelled: '❌',
};

const VALID_STATUSES = Object.keys(STATUS_EMOJI);

// Messages sent to users when admin updates their order status
const USER_STATUS_MESSAGES: Partial<Record<string, string>> = {
  processing: '⚙️ Ваш заказ принят в обработку.',
  shipped: '🚚 Ваш заказ отправлен!',
  delivered: '📦 Ваш заказ доставлен! Спасибо за покупку.',
  cancelled: '❌ Ваш заказ отменён. Обратитесь к менеджеру для уточнений.',
  paid: '✅ Оплата подтверждена. Ваш заказ обрабатывается.',
};

export function registerCommands(bot: Bot<Context>): void {
  // /start
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const user = ctx.from;
    if (!user) return;

    const isAdmin = ADMIN_IDS.includes(user.id);

    if (!isAdmin) {
      await db
        .insert(users)
        .values({ telegramId: user.id, username: user.username, firstName: user.first_name })
        .onConflictDoNothing();

      const keyboard = new InlineKeyboard()
        .webApp('🛍️ Открыть каталог', MINI_APP_URL)
        .row()
        .text('📋 Мои заказы', 'my_orders')
        .text('💬 Написать менеджеру', 'contact_manager')
        .row()
        .text('💡 Предложить товар', 'suggest_product');

      await ctx.reply(
        `Добро пожаловать в наш магазин! 🛒\n\nПросматривайте каталог и оплачивайте заказы через USDT (TRC20).`,
        { reply_markup: keyboard }
      );
    } else {
      const keyboard = new InlineKeyboard()
        .text('💬 Диалоги с пользователями', 'admin_dialogs')
        .row()
        .text('📦 Последние заказы', 'admin_orders');

      await ctx.reply(
        `👑 *Панель администратора*\n\nОтвечайте на сообщения пользователей — ответ придёт от имени бота анонимно.\n\n_Чтобы ответить: нажмите Reply на пересланном сообщении._`,
        { reply_markup: keyboard, parse_mode: 'Markdown' }
      );
    }
  });

  // /status <orderId>
  bot.command('status', async (ctx) => {
    const orderId = parseInt(ctx.match ?? '', 10);
    if (isNaN(orderId)) {
      await ctx.reply('Использование: /status <номер_заказа>');
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order || order.userId !== ctx.from?.id) {
      await ctx.reply('Заказ не найден.');
      return;
    }

    const emoji = STATUS_EMOJI[order.status] ?? '❓';
    await ctx.reply(
      `*Заказ #${order.id}*\n` +
        `Статус: ${emoji} ${order.status.replace('_', ' ')}\n` +
        `Сумма: $${order.totalUsdt} USDT\n` +
        (order.txHash ? `TX: \`${order.txHash}\`` : ''),
      { parse_mode: 'Markdown' }
    );
  });

  // User: My Orders
  bot.callbackQuery('my_orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;

    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(5);

    if (userOrders.length === 0) {
      await ctx.reply('У вас пока нет заказов.');
      return;
    }

    const lines = userOrders.map(
      (o) => `• Заказ #${o.id} — ${STATUS_EMOJI[o.status] ?? ''} ${o.status} — $${o.totalUsdt} USDT`
    );

    await ctx.reply(
      `*Последние ${userOrders.length} заказов:*\n\n${lines.join('\n')}\n\nИспользуйте /status <id> для подробностей.`,
      { parse_mode: 'Markdown' }
    );
  });

  // User: Contact Manager
  bot.callbackQuery('contact_manager', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '💬 Просто напишите сообщение, и менеджер ответит вам в ближайшее время.\n\nВаши данные остаются конфиденциальными.'
    );
  });

  // User: Suggest a Product
  bot.callbackQuery('suggest_product', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard().webApp(
      '💡 Открыть форму предложения',
      `${MINI_APP_URL}/suggest`
    );
    await ctx.reply('Есть идея для товара? Заполните форму:', { reply_markup: keyboard });
  });

  // Admin: Recent dialogs
  bot.callbackQuery('admin_dialogs', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const recent = await db
      .select()
      .from(messages)
      .where(eq(messages.direction, 'user_to_admin'))
      .orderBy(desc(messages.createdAt))
      .limit(10);

    if (recent.length === 0) {
      await ctx.reply('📭 Сообщений от пользователей пока нет.');
      return;
    }

    const seen = new Set<number>();
    const lines: string[] = [];
    for (const m of recent) {
      if (!m.userId || seen.has(m.userId)) continue;
      seen.add(m.userId);
      const preview = m.content.slice(0, 60).replace(/\n/g, ' ');
      lines.push(`• User #${m.userId}: _${preview}${m.content.length > 60 ? '…' : ''}_`);
    }

    await ctx.reply(
      `💬 *Последние диалоги:*\n\n${lines.join('\n')}\n\n_Переслать сообщение придёт автоматически при новом сообщении. Ответьте через Reply._`,
      { parse_mode: 'Markdown' }
    );
  });

  // Admin: Recent orders list with per-order management buttons
  bot.callbackQuery('admin_orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const recent = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(10);

    if (recent.length === 0) {
      await ctx.reply('📭 Заказов пока нет.');
      return;
    }

    const lines = recent.map(
      (o) =>
        `• #${o.id} — ${STATUS_EMOJI[o.status] ?? '❓'} ${o.status} — $${o.totalUsdt} USDT — User #${o.userId}`
    );

    // Buttons: up to 4 per row for compact display
    const keyboard = new InlineKeyboard();
    recent.forEach((o, i) => {
      keyboard.text(`📝 #${o.id}`, `admin_order_${o.id}`);
      if ((i + 1) % 4 === 0) keyboard.row();
    });

    await ctx.reply(
      `📦 *Последние заказы:*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Admin: Order detail + status change buttons
  bot.callbackQuery(/^admin_order_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const orderId = parseInt(ctx.match![1], 10);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      await ctx.reply('❌ Заказ не найден.');
      return;
    }

    const items = await db
      .select({
        quantity: orderItems.quantity,
        price: orderItems.priceUsdt,
        name: products.name,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, orderId));

    const itemLines = items.map((i) => `• ${i.name} × ${i.quantity} — $${i.price} USDT`);
    const emoji = STATUS_EMOJI[order.status] ?? '❓';
    const date = order.createdAt ? order.createdAt.toLocaleDateString('ru-RU') : '—';

    const text =
      `📦 *Заказ #${order.id}*\n\n` +
      `👤 Пользователь: #${order.userId}\n` +
      `💰 Сумма: $${order.totalUsdt} USDT\n` +
      `📊 Статус: ${emoji} ${order.status}\n` +
      `🕐 Создан: ${date}` +
      (order.txHash ? `\n🔗 TX: \`${order.txHash}\`` : '') +
      (itemLines.length ? `\n\n*Позиции:*\n${itemLines.join('\n')}` : '');

    // Show all statuses except current; 2 per row
    const statusOptions: Array<[string, string]> = [
      ['awaiting_payment', '💳'],
      ['paid', '✅'],
      ['processing', '⚙️'],
      ['shipped', '🚚'],
      ['delivered', '📦'],
      ['cancelled', '❌'],
    ];

    const keyboard = new InlineKeyboard();
    let btnCount = 0;
    for (const [status, statusEmoji] of statusOptions) {
      if (status === order.status) continue;
      keyboard.text(`${statusEmoji} ${status}`, `set_status_${order.id}_${status}`);
      btnCount++;
      if (btnCount % 2 === 0) keyboard.row();
    }

    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Admin: Apply status change, notify user
  bot.callbackQuery(/^set_status_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const orderId = parseInt(ctx.match![1], 10);
    const newStatus = ctx.match![2];

    if (!VALID_STATUSES.includes(newStatus)) {
      await ctx.reply('❌ Неверный статус.');
      return;
    }

    const [updated] = await db
      .update(orders)
      .set({
        status: newStatus,
        ...(newStatus === 'paid' ? { paidAt: new Date() } : {}),
      })
      .where(eq(orders.id, orderId))
      .returning();

    if (!updated) {
      await ctx.reply('❌ Заказ не найден.');
      return;
    }

    await ctx.reply(
      `✅ Статус заказа #${orderId} обновлён: ${STATUS_EMOJI[newStatus] ?? ''} *${newStatus}*`,
      { parse_mode: 'Markdown' }
    );

    const userMsg = USER_STATUS_MESSAGES[newStatus];
    if (userMsg && updated.userId) {
      try {
        await ctx.api.sendMessage(
          updated.userId,
          `${userMsg}\n\n*Заказ #${orderId}*`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error(`[status] Failed to notify user ${updated.userId}:`, err);
      }
    }
  });
}
