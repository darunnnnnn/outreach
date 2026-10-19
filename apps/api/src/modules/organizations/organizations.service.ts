import type { Prisma } from '@prisma/client';
import type {
  AuditLogQuery,
  AuditLogResponse,
  MemberResponse,
  OrganizationResponse,
  Paginated,
  Role,
  UpdateOrganizationInput,
} from '@outreach/shared';
import { prisma, type Tx } from '../../db/prisma';
import type { RequestContext } from '../../http/context';
import { ConflictError, ForbiddenError, NotFoundError } from '../../http/errors';
import { recordAudit } from '../audit/audit.service';

function auditMeta(ctx: RequestContext) {
  return { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null };
}

export async function getCurrent(ctx: RequestContext): Promise<OrganizationResponse> {
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    include: { _count: { select: { memberships: true } } },
  });
  if (!org) throw new NotFoundError('Organization');

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    timezone: org.timezone,
    plan: org.plan,
    settings: (org.settings ?? {}) as Record<string, unknown>,
    createdAt: org.createdAt.toISOString(),
    memberCount: org._count.memberships,
  };
}

export async function updateCurrent(
  ctx: RequestContext,
  input: UpdateOrganizationInput,
): Promise<OrganizationResponse> {
  const data: Prisma.OrganizationUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.settings !== undefined) data.settings = input.settings as Prisma.InputJsonValue;

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: ctx.organizationId }, data });
    await recordAudit(
      {
        action: 'org.updated',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'organization',
        targetId: ctx.organizationId,
        metadata: { fields: Object.keys(data) },
        ...auditMeta(ctx),
      },
      tx,
    );
  });

  return getCurrent(ctx);
}

export async function listMembers(ctx: RequestContext): Promise<MemberResponse[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });

  return memberships.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedAt: m.createdAt.toISOString(),
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    isSelf: m.user.id === ctx.userId,
  }));
}

/** Counts OWNER memberships, which is the check behind every last-owner rule. */
async function ownerCount(organizationId: string, client: Tx = prisma): Promise<number> {
  return client.membership.count({ where: { organizationId, role: 'OWNER' } });
}

async function findMembership(organizationId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!membership) throw new NotFoundError('Member');
  return membership;
}

export async function updateMemberRole(
  ctx: RequestContext,
  targetUserId: string,
  role: Exclude<Role, 'OWNER'>,
): Promise<MemberResponse[]> {
  const target = await findMembership(ctx.organizationId, targetUserId);

  if (target.role === role) return listMembers(ctx);

  // Only an OWNER may act on another OWNER; otherwise an ADMIN could demote the
  // person who can remove them.
  if (target.role === 'OWNER' && ctx.role !== 'OWNER') {
    throw new ForbiddenError('Only an owner can change another owner’s role');
  }

  if (target.role === 'OWNER' && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new ConflictError(
      'This is the last owner. Transfer ownership to someone else first.',
      { role: 'Last owner cannot be demoted' },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
      data: { role },
    });
    await recordAudit(
      {
        action: 'member.role_changed',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { from: target.role, to: role, targetEmail: target.user.email },
        ...auditMeta(ctx),
      },
      tx,
    );
  });

  return listMembers(ctx);
}

export async function removeMember(ctx: RequestContext, targetUserId: string): Promise<void> {
  const target = await findMembership(ctx.organizationId, targetUserId);

  if (target.role === 'OWNER' && ctx.role !== 'OWNER') {
    throw new ForbiddenError('Only an owner can remove another owner');
  }
  if (target.role === 'OWNER' && (await ownerCount(ctx.organizationId)) <= 1) {
    throw new ConflictError(
      'This is the last owner. Transfer ownership before removing this member.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
    });
    await recordAudit(
      {
        action: 'member.removed',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'user',
        targetId: targetUserId,
        metadata: {
          removedRole: target.role,
          targetEmail: target.user.email,
          selfRemoval: targetUserId === ctx.userId,
        },
        ...auditMeta(ctx),
      },
      tx,
    );
  });
}

/**
 * Promotes a member to OWNER and steps the acting owner down to ADMIN. Done in
 * one transaction so the organisation is never left with zero or two owners by
 * accident.
 */
export async function transferOwnership(
  ctx: RequestContext,
  targetUserId: string,
): Promise<MemberResponse[]> {
  if (targetUserId === ctx.userId) {
    throw new ConflictError('You already own this organization');
  }
  const target = await findMembership(ctx.organizationId, targetUserId);

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
      data: { role: 'OWNER' },
    });
    await tx.membership.update({
      where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
      data: { role: 'ADMIN' },
    });
    await recordAudit(
      {
        action: 'org.ownership_transferred',
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { previousRole: target.role, targetEmail: target.user.email },
        ...auditMeta(ctx),
      },
      tx,
    );
  });

  return listMembers(ctx);
}

export async function listAuditLogs(
  ctx: RequestContext,
  query: AuditLogQuery,
): Promise<Paginated<AuditLogResponse>> {
  const where: Prisma.AuditLogWhereInput = {
    organizationId: ctx.organizationId,
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actorUserId,
      actorName: row.actor?.name ?? null,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    },
  };
}
