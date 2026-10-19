import { z } from 'zod';

/** Roles, ordered weakest to strongest. The order is the authorisation rank. */
export const ROLES = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export const invitationStatusSchema = z.enum(INVITATION_STATUSES);

/** Error codes returned in `error.code`. Clients branch on these, not on messages. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'DEPENDENCY_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export const cuidSchema = z.string().min(1).max(64);

/** Trimmed, lower-cased email. Normalisation lives here so client and server agree. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Must be a valid email address');

export const nameSchema = z.string().trim().min(1, 'Required').max(120);
