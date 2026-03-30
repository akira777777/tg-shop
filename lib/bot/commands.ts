import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';
import { orders, orderItems, products, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

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

export function registerCommands(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    const user = ctx.from;
    if (user) {
      await db
        .insert(users)
        .values({ telegramId: user.id, username: user.username, firstName: user.first_name })
        .onConflictDoNothing();
    }

    const keyboard = new InlineKeyboard()
      .webApp('🛍️ Open Catalog', MINI_APP_URL)
      .row()
      .text('📋 My Orders', 'my_orders')
      .text('💬 Contact Manager', 'contact_manager')
      .row()
      .text('💡 Suggest a Product', 'suggest_product');

    await ctx.reply(
      `Welcome to our store! 🛒\n\nBrowse our catalog and pay securely with USDT (TRC20).`,
      { reply_markup: keyboard }
    );
  });

  // /status <orderId>
  bot.command('status', async (ctx) => {
    const orderId = parseInt(ctx.match ?? '', 10);
    if (isNaN(orderId)) {
      await ctx.reply('Usage: /status <order_id>');
      return;
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order || order.userId !== ctx.from?.id) {
      await ctx.reply('Order not found.');
      return;
    }

    const emoji = STATUS_EMOJI[order.status] ?? '❓';
    await ctx.reply(
      `*Order #${order.id}*\n` +
        `Status: ${emoji} ${order.status.replace('_', ' ')}\n` +
        `Total: $${order.totalUsdt} USDT\n` +
        (order.txHash ? `TX: \`${order.txHash}\`` : ''),
      { parse_mode: 'Markdown' }
    );
  });

  // Inline button: My Orders
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
      await ctx.reply('You have no orders yet.');
      return;
    }

    const lines = userOrders.map(
      (o) =>
        `• Order #${o.id} — ${STATUS_EMOJI[o.status] ?? ''} ${o.status} — $${o.totalUsdt} USDT`
    );

    await ctx.reply(
      `*Your last ${userOrders.length} orders:*\n\n${lines.join('\n')}\n\nUse /status <id> for details.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Inline button: Contact Manager
  bot.callbackQuery('contact_manager', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '💬 Just send me a text message and our manager will reply shortly.\n\nYour identity is kept private.'
    );
  });

  // Inline button: Suggest a Product
  bot.callbackQuery('suggest_product', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard().webApp(
      '💡 Open Suggestion Form',
      `${MINI_APP_URL}/suggest`
    );
    await ctx.reply('Have a product in mind? Fill out the form:', {
      reply_markup: keyboard,
    });
  });
}
