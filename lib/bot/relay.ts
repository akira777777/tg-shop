import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/db/schema';
import { redis } from '@/lib/redis';
import { eq } from 'drizzle-orm';

export const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

// Redis key for pending admin reply state (TTL 10 min)
const pendingKey = (adminId: number) => `pending_reply:${adminId}`;

export function registerRelayHandlers(bot: Bot<Context>): void {
  // USER → ADMIN: forward private text from non-admins
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const user = ctx.from;
    if (!user || ADMIN_IDS.includes(user.id)) return;

    await db
      .insert(users)
      .values({ telegramId: user.id, username: user.username, firstName: user.first_name })
      .onConflictDoNothing();

    const userLabel = user.username ? `@${user.username}` : user.first_name;

    // callback_data limit is 64 bytes — store only userId, look up label on click
    const keyboard = new InlineKeyboard().text(
      `💬 Ответить`,
      `reply_to:${user.id}`
    );

    const text =
      `📨 *Сообщение от ${escapeMarkdown(userLabel)}*\n\n` +
      escapeMarkdown(ctx.message.text);

    await Promise.allSettled(
      ADMIN_IDS.map((adminId) =>
        ctx.api
          .sendMessage(adminId, text, { parse_mode: 'Markdown', reply_markup: keyboard })
          .catch((err) => console.error(`[relay] Could not reach admin ${adminId}:`, err))
      )
    );

    try {
      await db.insert(messages).values({
        userId: user.id,
        direction: 'user_to_admin',
        content: ctx.message.text,
      });
    } catch (err) {
      console.error('[relay] Failed to save message to DB:', err);
    }

    await ctx.reply('✅ Ваше сообщение отправлено менеджеру. Ожидайте ответа.');
  });

  // ADMIN clicks "Ответить" → save pending state, prompt for reply text
  bot.callbackQuery(/^reply_to:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ADMIN_IDS.includes(ctx.from.id)) return;

    const userId = parseInt(ctx.match![1], 10);

    // Look up user label from DB
    const [userRow] = await db
      .select({ username: users.username, firstName: users.firstName })
      .from(users)
      .where(eq(users.telegramId, userId))
      .limit(1);

    const userLabel = userRow?.username
      ? `@${userRow.username}`
      : (userRow?.firstName ?? `#${userId}`);

    // Persist pending state: { userId, userLabel }
    await redis.set(
      pendingKey(ctx.from.id),
      JSON.stringify({ userId, userLabel }),
      { ex: 600 }
    );

    await ctx.reply(
      `✏️ Напишите ответ для *${escapeMarkdown(userLabel)}*\n` +
      `_Он придёт пользователю анонимно от имени бота._\n\n` +
      `Отправьте /cancel чтобы отменить.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ADMIN /cancel → clear pending reply state
  bot.command('cancel', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (!ADMIN_IDS.includes(ctx.from?.id ?? 0)) return;

    const deleted = await redis.del(pendingKey(ctx.from!.id));
    await ctx.reply(deleted ? '❌ Ответ отменён.' : 'Нет активного режима ответа.');
  });

  // ADMIN sends text → if pending reply, forward to user
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (!ADMIN_IDS.includes(ctx.from?.id ?? 0)) return;

    const raw = await redis.get<string>(pendingKey(ctx.from!.id));
    if (!raw) return;

    let pending: { userId: number; userLabel: string };
    try {
      pending = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof pending);
    } catch {
      await redis.del(pendingKey(ctx.from!.id));
      return;
    }

    await redis.del(pendingKey(ctx.from!.id));

    try {
      await ctx.api.sendMessage(
        pending.userId,
        `💬 *Менеджер:*\n\n${escapeMarkdown(ctx.message.text)}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(`✅ Ответ отправлен — ${escapeMarkdown(pending.userLabel)}.`);

      await db.insert(messages).values({
        userId: pending.userId,
        direction: 'admin_to_user',
        content: ctx.message.text,
      });
    } catch (err) {
      console.error('[relay] Failed to send reply to user:', err);
      await ctx.reply('❌ Не удалось доставить сообщение пользователю.');
    }
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
