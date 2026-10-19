import type {
  AcceptInvitationInput,
  CreateInvitationInput,
  InvitationResponse,
  PublicInvitationResponse,
  Role,
} from '@outreach/shared';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { generateToken, hashToken } from '../../lib/crypto';
import { mailIsLoggedNotSent, sendMail } from '../../lib/mailer';
import type { RequestContext } from '../../http/context';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../http/errors';
import { recordAudit } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueRefreshToken,
  signAccessToken,
} from '../auth/tokens';

function acceptUrl(token: string): string {
  return `${env.APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
}

function expiry(): Date {
  return new Date(Date.now() + env.INVITATION_TTL_DAYS * 86_400_000);
}

/**
 * Creates or refreshes an invitation. Re-inviting an address that already has a
 * pending invite issues a new token and extends the expiry — the "resend"
 * behaviour users expect — rather than failing or leaving two live tokens.
 */
export async function createInvitation(
  ctx: RequestContext,
  input: CreateInvitationInput,
): Promise<InvitationResponse> {
  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: ctx.organizationId, user: { email: input.email } },
    select: { id: true },
  });
  if (existingMember) {
    throw new ConflictError('That person is already a member of this organization', {
      email: 'Already a member',
    });
  }

  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = expiry();

  const invitation = await prisma.$transaction(async (tx) => {
    const pending = await tx.invitation.findFirst({
      where: { organizationId: ctx.organizationId, email: input.email, status: 'PENDING' },
      select: { id: true },
    });

    const row = pending
      ? await tx.invitation.update({
          where: { id: pending.id },
          data: { role: input.role, tokenHash, expiresAt, invitedById: ctx.userId },
          include: { invitedBy: { select: { name: true } } },
        })
      : await tx.invitation.create({
          data: {
            organizationId: ctx.organizationId,
            email: input.email,
            role: input.role,
            tokenHash,
            expiresAt,
            invitedById: ctx.userId,
          },
          include: { invitedBy: { select: { name: true } } },
        });

    await recordAudit(
      {
        action: 'invitation.created',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'invitation',
        targetId: row.id,
        metadata: { email: input.email, role: input.role, resent: Boolean(pending) },
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );

    return row;
  });

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true },
  });

  const url = acceptUrl(token);
  await sendMail({
    to: input.email,
    subject: `${invitation.invitedBy.name} invited you to ${organization.name} on OutreachOS`,
    text: [
      `${invitation.invitedBy.name} has invited you to join ${organization.name} on OutreachOS as ${input.role}.`,
      '',
      `Accept the invitation: ${url}`,
      '',
      `This link expires on ${expiresAt.toISOString()}.`,
    ].join('\n'),
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    invitedByName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    // Only when mail is not actually delivered (local dev), so the inviter can
    // still complete the flow. Never returned once SMTP is configured.
    ...(mailIsLoggedNotSent() ? { acceptUrl: url } : {}),
  };
}

export async function listInvitations(ctx: RequestContext): Promise<InvitationResponse[]> {
  const rows = await prisma.invitation.findMany({
    where: { organizationId: ctx.organizationId },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    // Reported as EXPIRED on read even before the nightly sweep updates the row.
    status: row.status === 'PENDING' && row.expiresAt < new Date() ? 'EXPIRED' : row.status,
    invitedByName: row.invitedBy.name,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function revokeInvitation(ctx: RequestContext, id: string): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, status: true, email: true },
  });
  if (!invitation) throw new NotFoundError('Invitation');
  if (invitation.status !== 'PENDING') {
    throw new ConflictError(`Invitation is already ${invitation.status.toLowerCase()}`);
  }

  await prisma.$transaction(async (tx) => {
    // Clear any historical REVOKED row first: (org, email, status) is unique.
    await tx.invitation.deleteMany({
      where: { organizationId: ctx.organizationId, email: invitation.email, status: 'REVOKED' },
    });
    await tx.invitation.update({
      where: { id },
      data: { status: 'REVOKED', tokenHash: hashToken(generateToken(32)) },
    });
    await recordAudit(
      {
        action: 'invitation.revoked',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'invitation',
        targetId: id,
        metadata: { email: invitation.email },
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
      tx,
    );
  });
}

async function loadLiveInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { id: true, name: true } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invitation) throw new NotFoundError('Invitation');
  if (invitation.status !== 'PENDING') {
    throw new ConflictError(`This invitation has already been ${invitation.status.toLowerCase()}`);
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    throw new ConflictError('This invitation has expired. Ask for a new one.');
  }
  return invitation;
}

/** Public: lets the accept screen decide whether to ask for a name and password. */
export async function inspectInvitation(token: string): Promise<PublicInvitationResponse> {
  const invitation = await loadLiveInvitation(token);
  const user = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
    invitedByName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt.toISOString(),
    requiresAccount: user === null,
  };
}

export interface AcceptResult {
  organizationId: string;
  organizationName: string;
  role: Role;
  /** Present only when a new account was created, which signs the user straight in. */
  session?: {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    userId: string;
  };
}

/**
 * Accepting is deliberately split:
 *
 * - no account for the invited address -> create one (name + password required)
 *   and sign in, since there is nothing to log into yet;
 * - account exists -> the caller must already be authenticated as that address.
 *   Allowing a password here would let an invitation reset an existing account's
 *   credentials.
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
  meta: { ip?: string | undefined; userAgent?: string | undefined },
  authenticatedUserId?: string,
): Promise<AcceptResult> {
  const invitation = await loadLiveInvitation(token);

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, email: true, isActive: true },
  });

  if (existingUser) {
    if (!authenticatedUserId) {
      throw new UnauthenticatedError(
        `An account already exists for ${invitation.email}. Sign in with it to accept this invitation.`,
      );
    }
    if (authenticatedUserId !== existingUser.id) {
      throw new ForbiddenError('This invitation was issued to a different email address');
    }
    if (!existingUser.isActive) throw new ForbiddenError('Account is disabled');
  } else if (!input.name || !input.password) {
    throw new ValidationError({
      ...(input.name ? {} : { name: 'Required to create your account' }),
      ...(input.password ? {} : { password: 'Required to create your account' }),
    });
  }

  // Hashing is deliberately done before the transaction opens: bcrypt at cost 12
  // takes long enough that doing it inside would hold a connection and a row
  // lock for no reason.
  const passwordHash = existingUser ? null : await hashPassword(input.password!);

  const result = await prisma.$transaction(async (tx) => {
    const userId =
      existingUser?.id ??
      (
        await tx.user.create({
          data: {
            email: invitation.email,
            name: input.name!,
            passwordHash: passwordHash!,
            lastLoginAt: new Date(),
          },
          select: { id: true },
        })
      ).id;

    const alreadyMember = await tx.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: invitation.organizationId } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new ConflictError('You are already a member of this organization');
    }

    await tx.membership.create({
      data: { userId, organizationId: invitation.organizationId, role: invitation.role },
    });

    // Keep (org, email, status) unique: drop any superseded history row.
    await tx.invitation.deleteMany({
      where: {
        organizationId: invitation.organizationId,
        email: invitation.email,
        status: 'ACCEPTED',
      },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });

    await recordAudit(
      {
        action: 'invitation.accepted',
        organizationId: invitation.organizationId,
        actorUserId: userId,
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: {
          email: invitation.email,
          role: invitation.role,
          accountCreated: existingUser === null,
        },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      tx,
    );

    const refresh = existingUser ? null : await issueRefreshToken(userId, meta, tx);
    return { userId, refresh };
  });

  return {
    organizationId: invitation.organizationId,
    organizationName: invitation.organization.name,
    role: invitation.role,
    ...(result.refresh
      ? {
          session: {
            accessToken: signAccessToken(result.userId, result.refresh.sessionId),
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            refreshToken: result.refresh.token,
            refreshTokenExpiresAt: result.refresh.expiresAt,
            userId: result.userId,
          },
        }
      : {}),
  };
}
