import type { AppConfig } from '@everecho/config';

/**
 * Cache and distributed counters. Used for rate limiting and for invalidating
 * derived reads the instant consent changes — a stale cache is a way to serve
 * material after it was withdrawn.
 */
export interface CacheAdapter {
  readonly name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Removes every key under a prefix. Used on revocation and deletion. */
  deletePrefix(prefix: string): Promise<number>;
  increment(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

export class MemoryCacheAdapter implements CacheAdapter {
  readonly name = 'memory';
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  private live(key: string): { value: string; expiresAt: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const current = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.live(key);
    this.store.set(key, {
      value: String(current),
      expiresAt: existing?.expiresAt ?? Date.now() + ttlSeconds * 1000,
    });
    return current;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

/**
 * Redis. UNVERIFIED in this build: no Redis server was reachable. Set
 * CACHE_DRIVER=redis with REDIS_URL to use it across multiple API instances.
 */
export class RedisCacheAdapter implements CacheAdapter {
  readonly name = 'redis';
  /** Only the commands this adapter uses, typed rather than left as Function. */
  private client:
    | {
        get(key: string): Promise<string | null>;
        set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
        del(...keys: string[]): Promise<number>;
        scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
        incr(key: string): Promise<number>;
        expire(key: string, seconds: number): Promise<unknown>;
        quit(): Promise<unknown>;
      }
    | undefined;

  constructor(private readonly cfg: AppConfig) {}

  private async connection() {
    if (!this.client) {
      const { default: Redis } = await import('ioredis');
      this.client = new Redis(this.cfg.env.REDIS_URL ?? '') as never;
    }
    return this.client!;
  }

  async get(key: string): Promise<string | null> {
    return (await this.connection()).get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await (await this.connection()).set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await (await this.connection()).del(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const client = await this.connection();
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await client.del(...keys);
        removed += keys.length;
      }
    } while (cursor !== '0');
    return removed;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const client = await this.connection();
    const value = await client.incr(key);
    if (value === 1) await client.expire(key, ttlSeconds);
    return value;
  }

  async close(): Promise<void> {
    await this.client?.quit();
    this.client = undefined;
  }
}

export function createCache(cfg: AppConfig): CacheAdapter {
  return cfg.env.CACHE_DRIVER === 'redis' ? new RedisCacheAdapter(cfg) : new MemoryCacheAdapter();
}

/** Cache keys are namespaced by archive so revocation can clear them wholesale. */
export const cacheKeys = {
  archivePrefix: (archiveId: string) => `archive:${archiveId}:`,
  consentPolicy: (archiveId: string) => `archive:${archiveId}:consent`,
  memberships: (archiveId: string, userId: string) => `archive:${archiveId}:member:${userId}`,
  rateLimit: (bucket: string, key: string) => `rl:${bucket}:${key}`,
};
