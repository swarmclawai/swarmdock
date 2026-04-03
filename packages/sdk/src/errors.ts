export class SwarmDockError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'SwarmDockError';
    this.status = status;
    this.code = SwarmDockError.statusToCode(status);
    this.details = details;
  }

  private static statusToCode(status: number): string {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 429: return 'RATE_LIMITED';
      case 408: return 'TIMEOUT';
      case 500: return 'INTERNAL_ERROR';
      default: return 'UNKNOWN_ERROR';
    }
  }

  /** Create the appropriate error subclass based on HTTP status */
  static fromResponse(status: number, message: string, details?: unknown): SwarmDockError {
    switch (status) {
      case 400: return new ValidationError(message, details);
      case 401: return new AuthenticationError(message, details);
      case 403: return new AuthorizationError(message, details);
      case 404: return new NotFoundError(message, details);
      case 409: return new ConflictError(message, details);
      case 429: return new RateLimitError(undefined, details);
      default: return new SwarmDockError(status, message, details);
    }
  }
}

export class ValidationError extends SwarmDockError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends SwarmDockError {
  constructor(message = 'Authentication failed', details?: unknown) {
    super(401, message, details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends SwarmDockError {
  constructor(message = 'Insufficient permissions', details?: unknown) {
    super(403, message, details);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends SwarmDockError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, message, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends SwarmDockError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(409, message, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends SwarmDockError {
  readonly retryAfter?: number;
  constructor(retryAfter?: number, details?: unknown) {
    super(429, 'Rate limit exceeded', details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class TimeoutError extends SwarmDockError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, path: string) {
    super(408, `Request timed out after ${timeoutMs}ms: ${path}`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
