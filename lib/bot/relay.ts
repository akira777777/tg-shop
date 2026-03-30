import { Bot, Context } from 'grammy';
import { redis } from '@/lib/redis';
import { db } from '@/lib/db';
import { messages, users } from '@/lib/db/schema';

// Comma-separated admin Telegram user IDs, e.g. "123456,789012"
const ADMIN_IDS: number[] = (process.env.ADMIN_CHAT_IDS ?? '')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));

const RELAY_TTL = 60 * 60 * 24 * 7; // 7 days

/**
 * Registers relay handlers on the bot:
 *  - User DM (non-admin) → forwarded anonymously to all admins via DM
 *  - Admin DM reply → forwarded back to the original user as "Manager:"
 */
export function registerRelayHandlers(bot: Bot<Context>): void {
  // USER → ADMIN DMs
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;

    const user = ctx.from;
    if (!user) return;

    // Don't relay admin messages to other admins
    if (ADMIN_IDS.includes(user.id)) return;

    await db
      .insert(users)
      .values({ telegramId: user.id, username: user.username, firstName: user.first_name })
      .onConflictDoNothing();

    const text =
      `📨 *Message from User #${user.id}* (${escapeMarkdown(user.first_name)}):\n\n` +
      `${escapeMarkdown(ctx.message.text)}\n\n` +
      `_Reply to this message to respond anonymously._`;

    // Forward to every admin — store each sent msg ID → user ID for reply routing
    for (const adminId of ADMIN_IDS) {
      try {
        const sent = await ctx.api.sendMessage(adminId, text, { parse_mode: 'Markdown' });
        await redis.set(`relay:${sent.message_id}`, user.id, { ex: RELAY_TTL });
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
  });

  // ADMIN DM reply → USER
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (!ADMIN_IDS.includes(ctx.from?.id ?? 0)) return;
    if (!ctx.message.reply_to_message) return;

    const originalMsgId = ctx.message.reply_to_message.message_id;
    let targetUserId: number | null = null;
    try {
      targetUserId = await redis.get<number>(`relay:${originalMsgId}`);
    } catch (err) {
      console.error('[relay] Redis lookup failed:', err);
      return;
    }
    if (!targetUserId) return;

    try {
      await ctx.api.sendMessage(
        targetUserId,
        `💬 *Manager:*\n\n${escapeMarkdown(ctx.message.text)}`,
        { parse_mode: 'Markdown' }
      );
      await db.insert(messages).values({
        userId: targetUserId,
        direction: 'admin_to_user',
        content: ctx.message.text,
      });
    } catch (err) {
      console.error('[relay] Failed to send reply to user:', err);
    }
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
