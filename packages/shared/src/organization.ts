import { z } from 'zod';
import {
  cuidSchema,
  emailSchema,
  invitationStatusSchema,
  nameSchema,
  paginationSchema,
  roleSchema,
} from './common';

export const updateOrganizationSchema = z
  .object({
    name: nameSchema.optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** OWNER is assigned through transfer-ownership, never through a role change. */
export const assignableRoleSchema = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);

export const updateMemberRoleSchema = z.object({
  role: assignableRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const transferOwnershipSchema = z.object({
  userId: cuidSchema,
});
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema.default('MEMBER'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  /** Required when the invited email has no account yet; ignored otherwise. */
  name: nameSchema.optional(),
  password: z.string().min(10).max(200).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const auditLogQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(64).optional(),
  actorUserId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: string;
  memberCount: number;
}

export interface MemberResponse {
  userId: string;
  name: string;
  email: string;
  role: z.infer<typeof roleSchema>;
  joinedAt: string;
  lastLoginAt: string | null;
  isSelf: boolean;
}

export interface InvitationResponse {
  id: string;
  email: string;
  role: z.infer<typeof roleSchema>;
  status: z.infer<typeof invitationStatusSchema>;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
  /** Present only in the create response, and only when mail is logged not sent. */
  acceptUrl?: string;
}

export interface PublicInvitationResponse {
  email: string;
  role: z.infer<typeof roleSchema>;
  organizationName: string;
  invitedByName: string;
  expiresAt: string;
  /** Tells the accept screen whether to ask for a name and password. */
  requiresAccount: boolean;
}

export interface AuditLogResponse {
  id: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}
