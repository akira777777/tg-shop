import { db } from '@/lib/db';
import { messages as messagesTable } from '@/lib/db/schema';
import { getUserLocale, tr } from './user-lang';
import { ADMIN_IDS, tgSend } from './telegram-api';

/** Shared HTML escape for bot-sent content. Keeps us one source of truth so a
 *  CVE in the escape list can be patched in a single place. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SendAdminReplyArgs {
  /** Telegram ID of the admin sending the reply. */
  adminId: number;
  /** Recipient user's Telegram ID. */
  userId: number;
  /** Human-readable label for the recipient (used only in other-admin notification). */
  userLabel?: string | null;
  /** Display label for the admin (username or full name) — used when notifying other admins. */
  adminLabel?: string | null;
  /** Raw admin reply text (plain text; this helper HTML-escapes it). */
  content: string;
}

/** Deliver an anonymous admin reply to a user, persist it to `messages`, and
 *  optionally notify the other admins. Used by both the bot's inline
 *  "Reply" flow (lib/bot/handlers.ts) and the admin panel REST endpoint
 *  (app/api/admin/dialogs/[userId]/route.ts) so changes to the wire format
 *  or escaping live in exactly one place. */
export async function sendAdminReplyToUser(args: SendAdminReplyArgs): Promise<void> {
  const { adminId, userId, userLabel, adminLabel, content } = args;

  const locale = await getUserLocale(userId);
  await tgSend(userId, `${tr('reply.prefix', locale)}\n\n${escapeHtml(content)}`);

  // Persist. Failures are logged but don't abort — the user already got the
  // message and blowing up here would give the admin a false "send failed".
  await db
    .insert(messagesTable)
    .values({ userId, direction: 'admin_to_user', content })
    .catch((err) => console.error('[relay] DB insert failed:', err));

  // Notify other admins so a team doesn't accidentally double-reply. Never
  // fatal — Promise.allSettled swallows individual failures.
  const otherAdmins = ADMIN_IDS.filter((id) => id !== adminId);
  if (otherAdmins.length === 0) return;

  const whoHtml = adminLabel ? escapeHtml(adminLabel) : `#${adminId}`;
  const toHtml = userLabel ? escapeHtml(userLabel) : `#${userId}`;
  const preview = escapeHtml(content.slice(0, 200));
  await Promise.allSettled(
    otherAdmins.map((other) =>
      tgSend(
        other,
        `📤 <b>${whoHtml}</b> ответил(а) пользователю <b>${toHtml}</b>:\n\n<i>${preview}</i>`,
      ),
    ),
  );
}
