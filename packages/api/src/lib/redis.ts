// Redis client with graceful fallback when not installed/configured.
// Uses dynamic import so the 'redis' package is optional.

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; NX?: boolean }): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl?(key: string): Promise<number>;
  connect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
};

let client: RedisClient | null = null;
let connectionAttempted = false;

type UpstashResponse<T> = {
  result?: T;
  error?: string;
};

function createUpstashRestClient(url: string, token: string): RedisClient {
  const endpoint = url.replace(/\/+$/, '');

  async function command<T>(parts: Array<string | number>): Promise<T> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parts),
    });

    if (!response.ok) {
      throw new Error(`Upstash Redis REST request failed: ${response.status}`);
    }

    const body = await response.json() as UpstashResponse<T>;
    if (body.error) {
      throw new Error(`Upstash Redis REST command failed: ${body.error}`);
    }

    return body.result as T;
  }

  return {
    async get(key) {
      const value = await command<string | null>(['GET', key]);
      return value === null || value === undefined ? null : String(value);
    },
    async set(key, value, options) {
      const parts: Array<string | number> = ['SET', key, value];
      if (options?.EX) {
        parts.push('EX', options.EX);
      }
      if (options?.NX) {
        parts.push('NX');
      }
      return command<string | null>(parts);
    },
    async del(key) {
      const keys = Array.isArray(key) ? key : [key];
      return Number(await command<number>(['DEL', ...keys]));
    },
    async incr(key) {
      return Number(await command<number>(['INCR', key]));
    },
    async expire(key, seconds) {
      return command<number>(['EXPIRE', key, seconds]);
    },
    async ttl(key) {
      return Number(await command<number>(['TTL', key]));
    },
    async connect() {
      return undefined;
    },
    on() {
      return undefined;
    },
  };
}

export async function getRedisClient(): Promise<RedisClient | null> {
  if (client) return client;
  if (connectionAttempted) return null;

  connectionAttempted = true;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    client = createUpstashRestClient(upstashUrl, upstashToken);
    return client;
  }

  if (upstashUrl || upstashToken) {
    console.error('[REDIS] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be configured');
  }

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    // Dynamic import - redis package is optional
    const redis = await (Function('return import("redis")')() as Promise<{ createClient: (opts: { url: string }) => unknown }>);
    const newClient = redis.createClient({ url }) as unknown as RedisClient;

    newClient.on('error', (err: unknown) => {
      console.error('[REDIS] client error:', err);
    });

    await newClient.connect();
    client = newClient;
    return client;
  } catch (err) {
    console.error('[REDIS] failed to connect (redis package may not be installed):', err);
    return null;
  }
}

export async function redisGet(key: string): Promise<string | null> {
  const c = await getRedisClient();
  if (!c) return null;
  try {
    return await c.get(key);
  } catch (err) {
    console.error('[REDIS] GET error:', err);
    return null;
  }
}

export async function redisSet(key: string, value: string, expirySeconds?: number): Promise<boolean> {
  const c = await getRedisClient();
  if (!c) return false;
  try {
    if (expirySeconds) {
      await c.set(key, value, { EX: expirySeconds });
    } else {
      await c.set(key, value);
    }
    return true;
  } catch (err) {
    console.error('[REDIS] SET error:', err);
    return false;
  }
}

export async function redisIncr(key: string): Promise<number | null> {
  const c = await getRedisClient();
  if (!c) return null;
  try {
    return await c.incr(key);
  } catch (err) {
    console.error('[REDIS] INCR error:', err);
    return null;
  }
}

export async function redisExpire(key: string, seconds: number): Promise<boolean> {
  const c = await getRedisClient();
  if (!c) return false;
  try {
    await c.expire(key, seconds);
    return true;
  } catch (err) {
    console.error('[REDIS] EXPIRE error:', err);
    return false;
  }
}

export async function redisTtl(key: string): Promise<number> {
  const c = await getRedisClient();
  if (!c) return -1;
  try {
    if (!c.ttl) return -1;
    return await c.ttl(key);
  } catch (err) {
    console.error('[REDIS] TTL error:', err);
    return -1;
  }
}

export function isRedisEnabled(): boolean {
  return client !== null;
}

/**
 * Acquire an advisory lock via Redis SET NX EX.
 * Returns a token string if the lock was acquired, null otherwise.
 * Falls back to a dummy token if Redis is unavailable (single-instance mode).
 */
export async function redisAcquireLock(key: string, ttlSeconds: number): Promise<string | null> {
  const c = await getRedisClient();
  if (!c) return 'no-redis'; // No Redis = single-instance, no lock needed
  try {
    const token = crypto.randomUUID();
    const result = await c.set(key, token, { EX: ttlSeconds, NX: true });
    return result !== null ? token : null;
  } catch (err) {
    console.error('[REDIS] lock acquire error:', err);
    return 'no-redis'; // Fail open — better to run duplicates than skip entirely
  }
}

/** Release a lock only if the caller still owns it (owner-safe). */
export async function redisReleaseLock(key: string, token: string): Promise<void> {
  const c = await getRedisClient();
  if (!c || token === 'no-redis') return;
  try {
    const current = await c.get(key);
    if (current === token) await c.del(key);
  } catch (err) {
    console.error('[REDIS] lock release error:', err);
  }
}

export function resetRedisClientForTests(): void {
  client = null;
  connectionAttempted = false;
}
