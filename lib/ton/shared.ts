/**
 * Pure TON utility functions — no server-side imports.
 * Safe to import from both server and client components.
 */

/** Payment comment embedded in every TON transfer for order routing. */
export function orderComment(orderId: number): string {
  return `ORDER-${orderId}`;
}

/**
 * Converts a USDT amount to TON, rounded up to 2 decimal places.
 * Always rounds up to avoid underpayment.
 */
export function usdtToTon(usdt: number, tonUsdPrice: number): number {
  if (tonUsdPrice <= 0) throw new Error(`Invalid TON price: ${tonUsdPrice}`);
  return Math.ceil((usdt / tonUsdPrice) * 100) / 100;
}

/** TON amount in nanotons (1 TON = 1_000_000_000 nanoton). */
export function toNanoton(ton: number): bigint {
  return BigInt(Math.round(ton * 1_000_000_000));
}
