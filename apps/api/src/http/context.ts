import type { Role } from '@outreach/shared';

/** Set by `authenticate` once the access token has been verified. */
export interface AuthContext {
  userId: string;
  sessionId: string;
}

/**
 * Set by `withOrg`. Every service takes this as its first argument — there is no
 * ambient tenant, so a query cannot accidentally run without one.
 */
export interface RequestContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      ctx?: RequestContext;
      /** Payload validated by `validate()`, replacing the raw body/query/params. */
      valid?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

/** Narrows an authenticated request after `authenticate` has run. */
export function requireAuthContext(auth: AuthContext | undefined): AuthContext {
  if (!auth) throw new Error('authenticate middleware did not run before this handler');
  return auth;
}

/** Narrows an org-scoped request after `withOrg` has run. */
export function requireRequestContext(ctx: RequestContext | undefined): RequestContext {
  if (!ctx) throw new Error('withOrg middleware did not run before this handler');
  return ctx;
}
