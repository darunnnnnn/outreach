import type { Prisma, User } from '@prisma/client';
import type {
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  MeResponse,
  MembershipSummary,
  RegisterInput,
  SessionUser,
} from '@outreach/shared';
import { prisma } from '../../db/prisma';
import { slugify } from '../../lib/crypto';
import { ConflictError, NotFoundError, UnauthenticatedError } from '../../http/errors';
import { recordAudit } from '../audit/audit.service';
import { burnTimingBudget, hashPassword, verifyPassword } from './password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueRefreshToken,
  revokeAllSessions,
  revokeSessionByToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokens';

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuthResult {
  response: AuthResponse;
  /** Raw refresh token — set as an httpOnly cookie by the controller. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function toSessionUser(user: Pick<User, 'id' | 'email' | 'name' | 'createdAt' | 'lastLoginAt'>): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

const membershipSelect = {
  role: true,
  organizationId: true,
  organization: { select: { name: true, slug: true } },
} satisfies Prisma.MembershipSelect;

function toMembershipSummaries(
  memberships: Array<{
    role: MembershipSummary['role'];
    organizationId: string;
    organization: { name: string; slug: string };
  }>,
): MembershipSummary[] {
  return memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    role: m.role,
  }));
}

export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    // Signup is the one place where disclosing existence is the lesser evil: the
    // alternative is an unusable form. Login remains uniform.
    throw new ConflictError('An account with this email already exists', {
      email: 'Already registered',
    });
  }

  const passwordHash = await hashPassword(input.password);

  // One transaction: a failure anywhere leaves no orphaned user or organisation.
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        lastLoginAt: new Date(),
      },
    });

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: slugify(input.organizationName),
        timezone: input.timezone,
      },
    });

    await tx.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
    });

    const refresh = await issueRefreshToken(user.id, meta, tx);

    await recordAudit(
      {
        action: 'auth.registered',
        organizationId: organization.id,
        actorUserId: user.id,
        targetType: 'organization',
        targetId: organization.id,
        metadata: { organizationName: organization.name },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      tx,
    );

    return { user, organization, refresh };
  });

  return {
    response: {
      accessToken: signAccessToken(created.user.id, created.refresh.sessionId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toSessionUser(created.user),
      memberships: [
        {
          organizationId: created.organization.id,
          organizationName: created.organization.name,
          organizationSlug: created.organization.slug,
          role: 'OWNER',
        },
      ],
      activeOrganizationId: created.organization.id,
    },
    refreshToken: created.refresh.token,
    refreshTokenExpiresAt: created.refresh.expiresAt,
  };
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { select: membershipSelect, orderBy: { createdAt: 'asc' } } },
  });

  // Identical message and comparable timing for "no such user" and "wrong
  // password", so the endpoint cannot be used to enumerate accounts.
  if (!user) {
    await burnTimingBudget();
    await recordAudit({
      action: 'auth.login_failed',
      metadata: { reason: 'unknown_email' },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw new UnauthenticatedError('Invalid email or password');
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk || !user.isActive) {
    await recordAudit({
      action: 'auth.login_failed',
      actorUserId: user.id,
      metadata: { reason: passwordOk ? 'inactive_account' : 'bad_password' },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    throw new UnauthenticatedError('Invalid email or password');
  }

  const refresh = await issueRefreshToken(user.id, meta);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const memberships = toMembershipSummaries(user.memberships);

  await recordAudit({
    action: 'auth.login',
    organizationId: memberships[0]?.organizationId ?? null,
    actorUserId: user.id,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    response: {
      accessToken: signAccessToken(user.id, refresh.sessionId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toSessionUser(updated),
      memberships,
      activeOrganizationId: memberships[0]?.organizationId ?? '',
    },
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export async function refresh(rawToken: string, meta: RequestMeta): Promise<AuthResult> {
  let rotated;
  try {
    rotated = await rotateRefreshToken(rawToken, meta);
  } catch (err) {
    const detail = err as { reuseDetected?: boolean; userId?: string };
    if (detail.reuseDetected) {
      // The classic stolen-token signal: a token that was already rotated came
      // back. `rotateRefreshToken` has revoked the family; this is the alert.
      await recordAudit({
        action: 'auth.refresh_reuse_detected',
        actorUserId: detail.userId ?? null,
        metadata: { severity: 'high' },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: rotated.userId },
    include: { memberships: { select: membershipSelect, orderBy: { createdAt: 'asc' } } },
  });
  if (!user) throw new UnauthenticatedError('Account no longer exists');

  const memberships = toMembershipSummaries(user.memberships);

  return {
    response: {
      accessToken: signAccessToken(user.id, rotated.sessionId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toSessionUser(user),
      memberships,
      activeOrganizationId: memberships[0]?.organizationId ?? '',
    },
    refreshToken: rotated.token,
    refreshTokenExpiresAt: rotated.expiresAt,
  };
}

export async function logout(
  rawToken: string | undefined,
  userId: string,
  meta: RequestMeta,
): Promise<void> {
  if (rawToken) await revokeSessionByToken(rawToken);
  await recordAudit({
    action: 'auth.logout',
    actorUserId: userId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
}

export async function logoutAll(userId: string, meta: RequestMeta): Promise<number> {
  const count = await revokeAllSessions(userId);
  await recordAudit({
    action: 'auth.logout_all',
    actorUserId: userId,
    metadata: { sessionsRevoked: count },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return count;
}

export async function me(userId: string): Promise<MeResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { select: membershipSelect, orderBy: { createdAt: 'asc' } } },
  });
  if (!user) throw new NotFoundError('User');

  const memberships = toMembershipSummaries(user.memberships);
  return {
    user: toSessionUser(user),
    memberships,
    activeOrganizationId: memberships.length === 1 ? memberships[0]!.organizationId : null,
  };
}

export async function updateProfile(
  userId: string,
  name: string,
  meta: RequestMeta,
): Promise<SessionUser> {
  const user = await prisma.user.update({ where: { id: userId }, data: { name } });
  await recordAudit({
    action: 'user.profile_updated',
    actorUserId: userId,
    targetType: 'user',
    targetId: userId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
  return toSessionUser(user);
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordInput,
  meta: RequestMeta,
): Promise<{ sessionsRevoked: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new NotFoundError('User');

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) {
    throw new UnauthenticatedError('Current password is incorrect');
  }
  if (input.currentPassword === input.newPassword) {
    throw new ConflictError('New password must differ from the current one', {
      newPassword: 'Must be different',
    });
  }

  const passwordHash = await hashPassword(input.newPassword);

  // Changing a password invalidates every other session: if the old password had
  // leaked, this is the action that ends the attacker's access.
  const { revoked } = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    const count = await revokeAllSessions(userId, { exceptSessionId: currentSessionId }, tx);
    await recordAudit(
      {
        action: 'auth.password_changed',
        actorUserId: userId,
        targetType: 'user',
        targetId: userId,
        metadata: { sessionsRevoked: count },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      tx,
    );
    return { revoked: count };
  });

  return { sessionsRevoked: revoked };
}
