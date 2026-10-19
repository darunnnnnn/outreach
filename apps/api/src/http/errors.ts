import type { ErrorCode } from '@outreach/shared';

/**
 * The only error type the HTTP layer knows how to translate. Services throw
 * these; anything else that escapes is logged with its stack and returned as a
 * generic 500, so an unexpected failure can never leak internals to a client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, string>;
  /** Marks errors that are part of normal operation and need no stack in the log. */
  readonly expected: boolean;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, string>; expected?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expected = options.expected ?? status < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Malformed request', details?: Record<string, string>) {
    super(400, 'BAD_REQUEST', message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

/**
 * Also used for resources that exist but belong to another tenant: disclosing
 * "exists, but not yours" would leak the other organisation's data.
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, string>) {
    super(409, 'CONFLICT', message, { details });
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, string>, message = 'Invalid request') {
    super(422, 'VALIDATION_ERROR', message, { details });
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Try again later.') {
    super(429, 'RATE_LIMITED', message);
  }
}

/** Plan or AI-budget ceiling reached (Phase 3+). */
export class LimitExceededError extends AppError {
  constructor(message: string, details?: Record<string, string>) {
    super(402, 'LIMIT_EXCEEDED', message, { details });
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(dependency: string, cause?: unknown) {
    super(503, 'DEPENDENCY_UNAVAILABLE', `${dependency} is unavailable`, { cause });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
