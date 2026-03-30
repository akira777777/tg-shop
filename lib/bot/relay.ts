import { Bot, Context } from 'grammy';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/db/schema';

export const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

// User ID is embedded at the end of the forwarded message for reply routing.
// Plain-text format, no special chars — safe for any Markdown parser.
const USER_ID_TAG = (userId: number) => `\n[uid:${userId}]`;
const USER_ID_PATTERN = /\[uid:(\d+)\]/;

export function registerRelayHandlers(bot: Bot<Context>): void {
  // USER → ADMIN: forward any private text from non-admins
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const user = ctx.from;
    if (!user || ADMIN_IDS.includes(user.id)) return;

    await db
      .insert(users)
      .values({ telegramId: user.id, username: user.username, firstName: user.first_name })
      .onConflictDoNothing();

    const name = user.username ? `@${user.username}` : escapeMarkdown(user.first_name);
    const text =
      `📨 *Сообщение от пользователя* (${name}):\n\n` +
      `${escapeMarkdown(ctx.message.text)}` +
      USER_ID_TAG(user.id);

    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.api.sendMessage(adminId, text, {
          parse_mode: 'Markdown',
        });
      } catch (err) {
        console.error(`[relay] Could not reach admin ${adminId}:`, err);
      }
    }

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

  // ADMIN reply → USER: reply to a forwarded message to respond anonymously
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (!ADMIN_IDS.includes(ctx.from?.id ?? 0)) return;
    if (!ctx.message.reply_to_message) return;

    const quoted = ctx.message.reply_to_message;
    const quotedText = quoted.text ?? quoted.caption ?? '';
    const match = quotedText.match(USER_ID_PATTERN);
    if (!match) return;

    const targetUserId = parseInt(match[1], 10);

    try {
      await ctx.api.sendMessage(
        targetUserId,
        `💬 *Менеджер:*\n\n${escapeMarkdown(ctx.message.text)}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply('✅ Ответ отправлен пользователю.');
      await db.insert(messages).values({
        userId: targetUserId,
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
