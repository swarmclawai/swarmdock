import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { redisIncr, redisExpire, redisGet, getRedisClient } from '../lib/redis.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyFn?: (c: Context) => string;
}

const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Rate limiter middleware for Hono.
 *
 * Uses Redis when available (multi-instance safe), falls back to in-memory Map.
 * Returns 429 Too Many Requests with a Retry-After header when the limit is exceeded.
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyFn } = options;
  const windowSeconds = Math.ceil(windowMs / 1000);

  // In-memory fallback store
  const memStore = new Map<string, RateLimitEntry>();
  let lastCleanup = Date.now();

  function cleanupMem() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [key, entry] of memStore.entries()) {
      if (entry.resetAt <= now) memStore.delete(key);
    }
  }

  return createMiddleware(async (c, next) => {
    const key = keyFn
      ? keyFn(c)
      : c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const redisKey = `rl:${windowSeconds}:${key}`;
    const redis = await getRedisClient();

    if (redis) {
      // Redis-backed rate limiting
      const count = await redisIncr(redisKey);
      if (count === null) {
        // Redis error — allow through
        await next();
        return;
      }
      if (count === 1) {
        await redisExpire(redisKey, windowSeconds);
      }
      if (count > maxRequests) {
        const ttlStr = await redisGet(`${redisKey}:ttl`).catch(() => null);
        const retryAfter = ttlStr ? parseInt(ttlStr, 10) : windowSeconds;
        throw new HTTPException(429, {
          message: 'Too many requests, please try again later',
          res: new Response('Too many requests, please try again later', {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + windowSeconds),
            },
          }),
        });
      }
      await next();
      return;
    }

    // In-memory fallback
    cleanupMem();
    const now = Date.now();
    const entry = memStore.get(key);

    if (!entry || entry.resetAt <= now) {
      memStore.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      throw new HTTPException(429, {
        message: 'Too many requests, please try again later',
        res: new Response('Too many requests, please try again later', {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
          },
        }),
      });
    }

    await next();
  });
}

/** Default rate limit: 60 requests per minute */
export const rateLimitDefault = rateLimit({
  windowMs: 60_000,
  maxRequests: 60,
});

/** Strict rate limit: 10 requests per minute */
export const rateLimitStrict = rateLimit({
  windowMs: 60_000,
  maxRequests: 10,
});

/** Auth rate limit: 20 requests per 5 minutes */
export const rateLimitAuth = rateLimit({
  windowMs: 300_000,
  maxRequests: 20,
});
