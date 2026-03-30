/**
 * Standardized application errors.
 * All route errors should throw AppError for a consistent response shape:
 *   { error: string, code: string, details?: object }
 */

import { HTTPException } from 'hono/http-exception';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'PAYMENT_FAILED'
  | 'INTERNAL_ERROR';

export class AppError extends HTTPException {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(status as 400, { message });
    this.code = code;
    this.details = details;
  }
}

/** Convenience factories */
export const Errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'BAD_REQUEST', message, details),

  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),

  unauthorized: (message = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', message),

  forbidden: (message = 'Access denied') =>
    new AppError(403, 'FORBIDDEN', message),

  notFound: (resource: string) =>
    new AppError(404, 'NOT_FOUND', `${resource} not found`),

  conflict: (message: string) =>
    new AppError(409, 'CONFLICT', message),

  rateLimited: (retryAfter?: number) =>
    new AppError(429, 'RATE_LIMITED', 'Rate limit exceeded', retryAfter ? { retryAfter } : undefined),

  paymentFailed: (message: string, details?: Record<string, unknown>) =>
    new AppError(502, 'PAYMENT_FAILED', message, details),

  internal: (message = 'Internal server error') =>
    new AppError(500, 'INTERNAL_ERROR', message),
} as const;
