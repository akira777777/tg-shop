import { MINI_APP_URL, tgDeleteMessage, tgEditMessageText, tgSend } from './telegram-api';

export class BroadcastNotConfiguredError extends Error {
  constructor() {
    super('BROADCAST_CHANNEL_ID is not set');
    this.name = 'BroadcastNotConfiguredError';
  }
}

export function getBroadcastChannelId(): string {
  const id = process.env.BROADCAST_CHANNEL_ID;
  if (!id) throw new BroadcastNotConfiguredError();
  return id;
}

export function isBroadcastConfigured(): boolean {
  return Boolean(process.env.BROADCAST_CHANNEL_ID);
}

function openShopKeyboard() {
  if (!MINI_APP_URL) return undefined;
  return {
    inline_keyboard: [[{ text: '🛍️ Открыть магазин', web_app: { url: MINI_APP_URL } }]],
  };
}

function productKeyboard(productId: number) {
  if (!MINI_APP_URL) return undefined;
  return {
    inline_keyboard: [
      [{ text: '🛒 Открыть товар', web_app: { url: `${MINI_APP_URL}/product/${productId}` } }],
    ],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPrice(price: string): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return price;
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

export interface ProductPostInput {
  id: number;
  name: string;
  description?: string | null;
  priceUsdt: string;
}

export async function postAnnouncement(text: string): Promise<number> {
  const channelId = getBroadcastChannelId();
  const { messageId } = await tgSend(channelId, text, openShopKeyboard());
  return messageId;
}

export function renderProductPost(p: ProductPostInput): string {
  const header = `🆕 <b>${escapeHtml(p.name)}</b>`;
  const price = `💵 ${formatPrice(p.priceUsdt)} USDT`;
  const desc = p.description?.trim() ? `\n\n${escapeHtml(p.description.trim())}` : '';
  return `${header}\n${price}${desc}`;
}

export async function postProduct(p: ProductPostInput): Promise<number> {
  const channelId = getBroadcastChannelId();
  const { messageId } = await tgSend(channelId, renderProductPost(p), productKeyboard(p.id));
  return messageId;
}

export async function markProductRemoved(
  messageId: number,
  product: ProductPostInput,
): Promise<void> {
  const channelId = getBroadcastChannelId();
  const body = renderProductPost(product);
  const text = `❌ <b>Снят с продажи</b>\n\n<s>${stripHtml(body)}</s>`;
  await tgEditMessageText(channelId, messageId, text);
}

export async function deleteChannelMessage(messageId: number): Promise<void> {
  const channelId = getBroadcastChannelId();
  await tgDeleteMessage(channelId, messageId);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
