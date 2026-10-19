import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env, isTestEnv } from '../../config/env';
import { logger } from '../../config/logger';
import { getRedis } from '../../queue/connection';
import { RateLimitedError } from '../errors';

const passthrough: RequestHandler = (_req, _res, next: NextFunction) => next();

/**
 * Redis-backed when configured, so limits hold across API replicas. The
 * in-memory fallback is per-process and therefore only correct for local
 * development — a deployment with several replicas and no Redis would multiply
 * every limit by the replica count.
 */
function makeStore(prefix: string): Store | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(...(args as [string, ...string[]])) as never,
  });
}

interface LimiterOptions {
  name: string;
  windowMs: number;
  limit: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export function createLimiter(options: LimiterOptions): RequestHandler {
  // Rate limiting is disabled under test so suites stay deterministic, and can be
  // switched off locally with RATE_LIMIT_DISABLED=true when testing bulk flows.
  if (isTestEnv || env.RATE_LIMIT_DISABLED) return passthrough;

  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: makeStore(options.name),
    keyGenerator: options.keyGenerator,
    handler: (req: Request, _res: Response, next: NextFunction) => {
      logger.warn(
        { requestId: req.requestId, path: req.path, limiter: options.name },
        'rate limit exceeded',
      );
      next(new RateLimitedError(options.message));
    },
  });
}

/** Global guard rail. Deliberately generous: it exists to blunt abuse, not to shape usage. */
export const globalLimiter = createLimiter({
  name: 'global',
  windowMs: 5 * 60_000,
  limit: 300,
});

/** Credential-stuffing guard, keyed by IP. */
export const authLimiter = createLimiter({
  name: 'auth',
  windowMs: 15 * 60_000,
  limit: 10,
  message: 'Too many authentication attempts. Try again in a few minutes.',
});

/**
 * Keyed by the submitted email as well, so a distributed attack against one
 * account is limited even when each attempt comes from a different address.
 */
export const authEmailLimiter = createLimiter({
  name: 'auth-email',
  windowMs: 15 * 60_000,
  limit: 5,
  message: 'Too many attempts for this account. Try again in a few minutes.',
  keyGenerator: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? `email:${email.toLowerCase()}` : `ip:${req.ip ?? 'unknown'}`;
  },
});

export const refreshLimiter = createLimiter({
  name: 'refresh',
  windowMs: 15 * 60_000,
  limit: 60,
});

export const invitationLimiter = createLimiter({
  name: 'invitation',
  windowMs: 24 * 60 * 60_000,
  limit: 50,
  message: 'Daily invitation limit reached for this organization.',
  keyGenerator: (req) => `org:${req.ctx?.organizationId ?? req.ip ?? 'unknown'}`,
});
