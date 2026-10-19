import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../db/prisma';
import { logger } from '../../config/logger';

/**
 * The audit vocabulary. Kept as a closed union so a typo cannot create a new
 * action name that no dashboard or alert knows about. Later phases extend it.
 */
export const AUDIT_ACTIONS = [
  'auth.registered',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refreshed',
  'auth.refresh_reuse_detected',
  'auth.password_changed',
  'user.profile_updated',
  'org.updated',
  'org.ownership_transferred',
  'member.role_changed',
  'member.removed',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  organizationId?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes an audit row. Pass the transaction client when the audited change is
 * itself transactional, so the record and the change commit or fail together —
 * an audit log that can disagree with the data is worse than none.
 */
export async function recordAudit(entry: AuditEntry, client: Tx = prisma): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        action: entry.action,
        organizationId: entry.organizationId ?? null,
        actorUserId: entry.actorUserId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
        userAgent: entry.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    // Never let an audit write break the request it describes. It is logged at
    // error level because a persistent failure here is an incident in itself.
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}
