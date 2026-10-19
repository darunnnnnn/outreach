import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../db/prisma';
import { generateToken, hashToken } from '../../lib/crypto';
import { UnauthenticatedError } from '../../http/errors';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

/** Parses `15m`, `900s`, `2h`, `1d` or a bare number of seconds. */
export function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}

export const ACCESS_TOKEN_TTL_SECONDS = parseDurationToSeconds(env.ACCESS_TOKEN_TTL);

/**
 * Access tokens deliberately carry no role or organisation. Authorisation is
 * resolved from the database on every request, so revoking a membership or
 * demoting a user takes effect immediately rather than at the next token refresh.
 */
export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthenticatedError('Invalid access token');
    }
    const sid = (payload as jwt.JwtPayload & { sid?: unknown }).sid;
    if (typeof sid !== 'string' || sid.length === 0) {
      throw new UnauthenticatedError('Invalid access token');
    }
    return { sub: payload.sub, sid };
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw new UnauthenticatedError('Access token expired');
    throw new UnauthenticatedError('Invalid access token');
  }
}

export interface SessionMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface IssuedRefreshToken {
  sessionId: string;
  familyId: string;
  token: string;
  expiresAt: Date;
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

/** Creates the first session of a new rotation family (login, register, accept-invite). */
export async function issueRefreshToken(
  userId: string,
  meta: SessionMeta,
  client: Tx = prisma,
): Promise<IssuedRefreshToken> {
  const token = generateToken();
  const familyId = crypto.randomUUID();
  const expiresAt = refreshExpiry();
  const session = await client.session.create({
    data: {
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
    select: { id: true },
  });
  return { sessionId: session.id, familyId, token, expiresAt };
}

export interface RotationResult extends IssuedRefreshToken {
  userId: string;
  /** True when a rotated-away token was replayed: the family has been revoked. */
  reuseDetected?: boolean;
}

/**
 * Rotates a refresh token. Presenting a token that was already rotated means the
 * token was captured: the entire family is revoked so neither the attacker nor
 * the victim can continue with it, and the caller is expected to audit the event.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: SessionMeta,
): Promise<RotationResult> {
  const tokenHash = hashToken(rawToken);

  const existing = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      revokedAt: true,
      replacedById: true,
      expiresAt: true,
      user: { select: { isActive: true } },
    },
  });

  if (!existing) throw new UnauthenticatedError('Invalid refresh token');

  const wasRotated = existing.replacedById !== null;
  if (wasRotated || existing.revokedAt !== null) {
    await prisma.session.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const error = new UnauthenticatedError('Refresh token is no longer valid');
    (error as UnauthenticatedError & { reuseDetected?: boolean; userId?: string }).reuseDetected =
      wasRotated;
    (error as UnauthenticatedError & { userId?: string }).userId = existing.userId;
    throw error;
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('Refresh token expired');
  }
  if (!existing.user.isActive) {
    throw new UnauthenticatedError('Account is disabled');
  }

  const token = generateToken();
  const expiresAt = refreshExpiry();

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.session.create({
      data: {
        userId: existing.userId,
        familyId: existing.familyId,
        tokenHash: hashToken(token),
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
      select: { id: true },
    });
    await tx.session.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });
    return next;
  });

  return {
    sessionId: created.id,
    familyId: existing.familyId,
    userId: existing.userId,
    token,
    expiresAt,
  };
}

export async function revokeSessionByToken(rawToken: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function revokeAllSessions(
  userId: string,
  options: { exceptSessionId?: string } = {},
  client: Tx = prisma,
): Promise<number> {
  const result = await client.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** True when the session behind an access token is still live. */
export async function sessionIsActive(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!session) return false;
  return session.revokedAt === null && session.expiresAt.getTime() > Date.now();
}
