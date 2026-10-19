import { z } from 'zod';
import { emailSchema, nameSchema, roleSchema } from './common';

/**
 * A short deny-list of passwords that pass a length check but are trivially
 * guessed. Deliberately small: composition rules push users towards `Passw0rd!`,
 * length plus a deny-list is the better trade-off.
 */
export const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'letmein123',
  'welcome123',
  'iloveyou123',
  'administrator',
  'changeme123',
  'outreach123',
]);

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'This password is too common. Choose something less guessable.',
  })
  .refine((v) => v.trim().length === v.length, {
    message: 'Must not start or end with a space',
  });

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  organizationName: nameSchema,
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** The refresh token may arrive in the httpOnly cookie instead of the body. */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  name: nameSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export interface AuthTokens {
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  /** Omitted when the refresh token was delivered as an httpOnly cookie only. */
  refreshToken?: string;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: z.infer<typeof roleSchema>;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MeResponse {
  user: SessionUser;
  memberships: MembershipSummary[];
  activeOrganizationId: string | null;
}

export interface AuthResponse extends AuthTokens {
  user: SessionUser;
  memberships: MembershipSummary[];
  activeOrganizationId: string;
}
