import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma';
import { UnauthenticatedError } from '../errors';
import { verifyAccessToken } from '../../modules/auth/tokens';

/**
 * Attaches `req.auth` when a valid token is present and does nothing otherwise.
 * Used by invitation acceptance, which behaves differently for a signed-in user
 * than for a visitor but must work for both.
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.header('authorization')) {
    next();
    return;
  }
  await authenticate(req, res, (err?: unknown) => {
    // An invalid token on an optional route is treated as "not signed in"
    // rather than as an error, so a stale token cannot block the flow.
    if (err) req.auth = undefined;
    next();
  });
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}

/**
 * Verifies the access token and confirms the session behind it is still live.
 * The extra session lookup is deliberate: it makes logout, password change and
 * refresh-token-theft revocation effective within one request instead of within
 * one access-token lifetime.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) throw new UnauthenticatedError('Missing bearer token');

    const claims = verifyAccessToken(token);

    const session = await prisma.session.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { isActive: true } },
      },
    });

    if (!session || session.userId !== claims.sub) {
      throw new UnauthenticatedError('Session not found');
    }
    if (session.revokedAt !== null) throw new UnauthenticatedError('Session has been revoked');
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthenticatedError('Session has expired');
    }
    if (!session.user.isActive) throw new UnauthenticatedError('Account is disabled');

    req.auth = { userId: session.userId, sessionId: session.id };
    next();
  } catch (err) {
    next(err);
  }
}
