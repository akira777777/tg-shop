/**
 * Chat SDK StateAdapter implementation backed by @upstash/redis REST API.
 *
 * Replaces @chat-adapter/state-redis (node-redis TCP) which hangs on cold
 * starts because Upstash's TCP port 6380 is unreachable from Vercel serverless.
 * The REST API (port 443 HTTPS) works fine and needs no persistent connection.
 */
import type { Lock, QueueEntry, StateAdapter } from 'chat';
import { Redis } from '@upstash/redis';

const DEFAULT_PREFIX = 'chat-sdk';

export function createUpstashState(redis: Redis, keyPrefix = DEFAULT_PREFIX): StateAdapter {
  const k = (key: string) => `${keyPrefix}:${key}`;

  const encode = (value: unknown) => JSON.stringify(value);
  const decode = <T>(raw: string | null): T | null => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  };

  return {
    // REST is stateless — no persistent connection needed
    async connect() {},
    async disconnect() {},

    // ── Subscriptions ─────────────────────────────────────────────────────
    async subscribe(threadId: string) {
      await redis.sadd(k('subscriptions'), threadId);
    },
    async unsubscribe(threadId: string) {
      await redis.srem(k('subscriptions'), threadId);
    },
    async isSubscribed(threadId: string) {
      const result = await redis.sismember(k('subscriptions'), threadId);
      return result === 1;
    },

    // ── Key-value store ───────────────────────────────────────────────────
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await redis.get<string>(k(key));
      return decode<T>(raw);
    },
    async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
      if (ttlMs) {
        await redis.set(k(key), encode(value), { px: ttlMs });
      } else {
        await redis.set(k(key), encode(value));
      }
    },
    async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
      const opts = ttlMs ? { nx: true as const, px: ttlMs } : { nx: true as const };
      const result = await redis.set(k(key), encode(value), opts);
      return result === 'OK';
    },
    async delete(key: string): Promise<void> {
      await redis.del(k(key));
    },

    // ── Lists ─────────────────────────────────────────────────────────────
    async appendToList(
      key: string,
      value: unknown,
      options?: { maxLength?: number; ttlMs?: number },
    ): Promise<void> {
      const listKey = k(key);
      await redis.rpush(listKey, encode(value));
      if (options?.maxLength) {
        // Keep the newest maxLength items (trim oldest from the left)
        await redis.ltrim(listKey, -options.maxLength, -1);
      }
      if (options?.ttlMs) {
        await redis.pexpire(listKey, options.ttlMs);
      }
    },
    async getList<T = unknown>(key: string): Promise<T[]> {
      const items = await redis.lrange<string>(k(key), 0, -1);
      return items.map((item) => decode<T>(item) as T);
    },

    // ── Message queue (per-thread) ────────────────────────────────────────
    async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
      const qKey = k(`queue:${threadId}`);
      const depth = await redis.rpush(qKey, encode(entry));
      if (depth > maxSize) {
        // Drop oldest entries, keeping the newest maxSize
        await redis.ltrim(qKey, depth - maxSize, -1);
        return maxSize;
      }
      return depth;
    },
    async dequeue(threadId: string): Promise<QueueEntry | null> {
      const raw = await redis.lpop<string>(k(`queue:${threadId}`));
      return decode<QueueEntry>(raw);
    },
    async queueDepth(threadId: string): Promise<number> {
      return await redis.llen(k(`queue:${threadId}`));
    },

    // ── Distributed locks (SET NX PX) ────────────────────────────────────
    async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
      const lockKey = k(`lock:${threadId}`);
      const token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const result = await redis.set(lockKey, token, { nx: true, px: ttlMs });
      if (result !== 'OK') return null;
      return { threadId, token, expiresAt: Date.now() + ttlMs };
    },
    async releaseLock(lock: Lock): Promise<void> {
      const lockKey = k(`lock:${lock.threadId}`);
      const current = await redis.get<string>(lockKey);
      if (current === lock.token) {
        await redis.del(lockKey);
      }
    },
    async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
      const lockKey = k(`lock:${lock.threadId}`);
      const current = await redis.get<string>(lockKey);
      if (current !== lock.token) return false;
      await redis.pexpire(lockKey, ttlMs);
      return true;
    },
    async forceReleaseLock(threadId: string): Promise<void> {
      await redis.del(k(`lock:${threadId}`));
    },
  };
}
