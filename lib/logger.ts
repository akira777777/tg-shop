/**
 * Minimal JSON logger. Vercel parses structured log lines automatically, so
 * emitting `{"scope":"tron-monitor","event":"checked",...}` makes events
 * searchable in the dashboard without an external aggregator.
 *
 * Keep the payload flat — nested objects print awkwardly in the Vercel UI.
 */

export interface LogFields {
  scope: string;
  event: string;
  orderId?: number;
  userId?: number;
  adminId?: number;
  [key: string]: unknown;
}

function serialize(fields: LogFields, level: 'info' | 'warn' | 'error'): string {
  const payload: Record<string, unknown> = { level, ts: new Date().toISOString(), ...fields };
  // Errors don't survive JSON.stringify by default — pull the useful bits out.
  if (payload.err instanceof Error) {
    const e = payload.err;
    payload.err = { name: e.name, message: e.message, stack: e.stack };
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ level, ts: payload.ts, scope: fields.scope, event: fields.event, err: 'log_serialize_failed' });
  }
}

export const log = {
  info(fields: LogFields): void {
    console.log(serialize(fields, 'info'));
  },
  warn(fields: LogFields): void {
    console.warn(serialize(fields, 'warn'));
  },
  error(fields: LogFields): void {
    console.error(serialize(fields, 'error'));
  },
};
