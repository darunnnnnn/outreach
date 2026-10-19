import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@outreach/shared';
import { roleAtLeast } from '@outreach/shared';
import { prisma } from '../../db/prisma';
import { ForbiddenError, UnauthenticatedError } from '../errors';

const ORG_HEADER = 'x-org-id';

/**
 * Resolves the active organisation and the caller's role in it.
 *
 * The id comes from the `X-Org-Id` header. When it is absent and the user belongs
 * to exactly one organisation, that one is used — convenient for the common case
 * without ever guessing between several.
 */
export async function withOrg(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) throw new UnauthenticatedError();

    const requested = req.header(ORG_HEADER)?.trim();

    if (requested) {
      const membership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: req.auth.userId, organizationId: requested } },
        select: { id: true, role: true, organizationId: true },
      });
      // Not a member and "no such org" are the same answer on purpose: otherwise
      // the header becomes an oracle for which organisation ids exist.
      if (!membership) throw new ForbiddenError('You are not a member of this organization');
      req.ctx = buildContext(req, membership.organizationId, membership.id, membership.role);
      next();
      return;
    }

    const memberships = await prisma.membership.findMany({
      where: { userId: req.auth.userId },
      select: { id: true, role: true, organizationId: true },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });

    if (memberships.length === 0) {
      throw new ForbiddenError('You do not belong to any organization');
    }
    if (memberships.length > 1) {
      throw new ForbiddenError(
        'You belong to multiple organizations. Send the X-Org-Id header to choose one.',
      );
    }

    const only = memberships[0]!;
    req.ctx = buildContext(req, only.organizationId, only.id, only.role);
    next();
  } catch (err) {
    next(err);
  }
}

function buildContext(req: Request, organizationId: string, membershipId: string, role: Role) {
  return {
    userId: req.auth!.userId,
    organizationId,
    membershipId,
    role,
    ip: req.ip,
    userAgent: req.header('user-agent'),
    requestId: req.requestId,
  };
}

/** `requireRole(ADMIN)` means "ADMIN or above" — see `roleAtLeast` in shared. */
export function requireRole(minimum: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.ctx) {
      next(new Error('withOrg middleware must run before requireRole'));
      return;
    }
    if (!roleAtLeast(req.ctx.role, minimum)) {
      next(new ForbiddenError(`This action requires the ${minimum} role or higher`));
      return;
    }
    next();
  };
}
