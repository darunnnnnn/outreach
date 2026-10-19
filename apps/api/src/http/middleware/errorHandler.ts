import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@outreach/shared';
import { logger } from '../../config/logger';
import { isProduction } from '../../config/env';
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  isAppError,
} from '../errors';

/** Maps the Prisma failures that are genuinely the client's fault. */
function translatePrismaError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = err.meta?.['target'];
        const field = Array.isArray(target) ? String(target.at(-1)) : undefined;
        return new ConflictError(
          field ? `A record with this ${field} already exists` : 'Record already exists',
          field ? { [field]: 'Already in use' } : undefined,
        );
      }
      case 'P2025':
        return new NotFoundError('Record');
      case 'P2003':
        return new ConflictError('Related record is missing or still referenced');
      default:
        return null;
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    // A malformed query is our bug, not the caller's — surface it as a 500.
    return null;
  }
  return null;
}

/**
 * body-parser rejects oversized or malformed payloads with its own error shape,
 * carrying a `type` and an HTTP status. Without this they would surface as 500s
 * and look like a server fault instead of a bad request.
 */
function translateBodyParserError(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as { type?: string; status?: number };
  switch (candidate.type) {
    case 'entity.too.large':
      return new AppError(413, 'BAD_REQUEST', 'Request body is too large');
    case 'entity.parse.failed':
      return new BadRequestError('Request body is not valid JSON');
    case 'encoding.unsupported':
      return new BadRequestError('Unsupported content encoding');
    default:
      return null;
  }
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = isAppError(err)
    ? err
    : (translateBodyParserError(err) ?? translatePrismaError(err));

  if (appError) {
    const log = { requestId: req.requestId, code: appError.code, path: req.path };
    if (appError.expected) logger.debug({ ...log, msg: appError.message }, 'request rejected');
    else logger.error({ ...log, err }, 'request failed');

    const body: ApiErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId: req.requestId,
      },
    };
    res.status(appError.status).json(body);
    return;
  }

  // Unknown failure: log everything, return nothing but a correlation id.
  logger.error(
    { requestId: req.requestId, path: req.path, method: req.method, err },
    'unhandled error',
  );

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'An unexpected error occurred'
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred',
      requestId: req.requestId,
    },
  };
  res.status(500).json(body);
};

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  };
  res.status(404).json(body);
}
