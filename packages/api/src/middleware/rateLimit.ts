import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

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
 * Simple in-memory rate limiter middleware for Hono.
 *
 * Uses a Map to track request counts per key within a sliding window.
 * Returns 429 Too Many Requests with a Retry-After header when the limit is exceeded.
 * Periodically cleans up expired entries every 60 seconds.
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyFn } = options;
  const store = new Map<string, RateLimitEntry>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;

    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }

  return createMiddleware(async (c, next) => {
    cleanup();

    const key = keyFn
      ? keyFn(c)
      : c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      // New window
      store.set(key, { count: 1, resetAt: now + windowMs });
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
