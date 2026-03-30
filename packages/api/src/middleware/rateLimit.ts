import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { redisIncr, redisExpire, redisGet, getRedisClient } from '../lib/redis.js';
import type { AuthContext } from './auth.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface SlidingWindowEntry {
  prevCount: number;
  currCount: number;
  windowStart: number;
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
 * Uses a sliding window algorithm with Redis when available (multi-instance safe),
 * falls back to in-memory sliding window.
 *
 * Sliding window: interpolates between two adjacent fixed windows to smooth burst edges.
 * Returns 429 Too Many Requests with an accurate Retry-After header when the limit is exceeded.
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyFn } = options;
  const windowSeconds = Math.ceil(windowMs / 1000);

  // In-memory fallback store (sliding window)
  const memStore = new Map<string, SlidingWindowEntry>();
  let lastCleanup = Date.now();

  function cleanupMem() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [key, entry] of memStore.entries()) {
      // Remove entries from 2+ windows ago
      if (now - entry.windowStart > 2 * windowMs) memStore.delete(key);
    }
  }

  function getWindowId(now: number): number {
    return Math.floor(now / windowMs);
  }

  return createMiddleware(async (c, next) => {
    const key = keyFn
      ? keyFn(c)
      : c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const now = Date.now();
    const currentWindowId = getWindowId(now);
    const elapsedInWindow = (now % windowMs) / windowMs; // 0-1 fraction
    const redis = await getRedisClient();

    if (redis) {
      // Redis-backed sliding window
      const currKey = `rl:${windowSeconds}:${currentWindowId}:${key}`;
      const prevKey = `rl:${windowSeconds}:${currentWindowId - 1}:${key}`;

      // Increment current window and get previous
      const currCount = await redisIncr(currKey);
      if (currCount === null) {
        // Redis error — allow through
        await next();
        return;
      }
      if (currCount === 1) {
        await redisExpire(currKey, windowSeconds * 2);
      }

      const prevStr = await redisGet(prevKey);
      const prevCount = prevStr ? parseInt(prevStr, 10) : 0;

      // Weighted sliding window count
      const weightedCount = prevCount * (1 - elapsedInWindow) + currCount;

      if (weightedCount > maxRequests) {
        const retryAfterSeconds = Math.ceil(windowSeconds * (1 - elapsedInWindow));
        throw new HTTPException(429, {
          message: 'Too many requests, please try again later',
          res: new Response('Too many requests, please try again later', {
            status: 429,
            headers: {
              'Retry-After': String(Math.max(1, retryAfterSeconds)),
              'X-RateLimit-Limit': String(maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil((currentWindowId + 1) * windowMs / 1000)),
            },
          }),
        });
      }

      const remaining = Math.max(0, Math.floor(maxRequests - weightedCount));
      await next();
      c.res.headers.set('X-RateLimit-Limit', String(maxRequests));
      c.res.headers.set('X-RateLimit-Remaining', String(remaining));
      return;
    }

    // In-memory sliding window fallback
    cleanupMem();
    const windowStart = currentWindowId * windowMs;
    let entry = memStore.get(key);

    if (!entry || getWindowId(entry.windowStart) < currentWindowId - 1) {
      // No entry or too old — start fresh
      entry = { prevCount: 0, currCount: 1, windowStart };
      memStore.set(key, entry);
      await next();
      return;
    }

    if (getWindowId(entry.windowStart) < currentWindowId) {
      // Roll forward: current becomes previous
      entry.prevCount = entry.currCount;
      entry.currCount = 1;
      entry.windowStart = windowStart;
    } else {
      entry.currCount++;
    }

    const weightedCount = entry.prevCount * (1 - elapsedInWindow) + entry.currCount;

    if (weightedCount > maxRequests) {
      const retryAfterSeconds = Math.ceil(windowSeconds * (1 - elapsedInWindow));
      throw new HTTPException(429, {
        message: 'Too many requests, please try again later',
        res: new Response('Too many requests, please try again later', {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, retryAfterSeconds)),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil((currentWindowId + 1) * windowMs / 1000)),
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

/** Premium rate limit: 120 requests per minute (2x default) */
export const rateLimitPremium = rateLimit({
  windowMs: 60_000,
  maxRequests: 120,
});

/**
 * Tier-aware rate limit middleware.
 *
 * Inspects the authenticated agent context (set by authMiddleware on `c.get('agent')`)
 * and applies the premium rate limit (120 req/min) for agents with premiumTier === 'pro'.
 * Falls back to the default rate limit (60 req/min) for unauthenticated requests
 * or agents on the free tier.
 */
export const tierAwareRateLimit = createMiddleware<AuthContext>(async (c, next) => {
  const agent = c.get('agent');
  const limiter = agent?.premiumTier === 'pro' ? rateLimitPremium : rateLimitDefault;

  // Delegate to the selected rate limiter's handler.
  // Hono middleware created by createMiddleware returns a handler function;
  // we invoke it directly so only one limiter runs per request.
  await limiter(c, next);
});
