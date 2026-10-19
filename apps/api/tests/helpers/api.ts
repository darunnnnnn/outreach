import request from 'supertest';
import type { Express } from 'express';
import type { Role } from '@outreach/shared';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';

let cached: Express | null = null;

/** One in-process app for the whole run; no port is bound. */
export function app(): Express {
  cached ??= createApp();
  return cached;
}

export interface TestActor {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  organizationId: string;
}

let counter = 0;
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}+${Date.now()}-${counter}@example.test`;
}

export const STRONG_PASSWORD = 'CorrectHorseBattery7';

/** Registers a new user with their own organisation; the user is its OWNER. */
export async function registerActor(
  overrides: Partial<{ email: string; password: string; organizationName: string }> = {},
): Promise<TestActor> {
  const email = overrides.email ?? uniqueEmail('owner');
  const res = await request(app())
    .post('/api/v1/auth/register')
    .send({
      name: 'Test Owner',
      email,
      password: overrides.password ?? STRONG_PASSWORD,
      organizationName: overrides.organizationName ?? `Org ${counter}`,
    })
    .expect(201);

  return {
    userId: res.body.user.id,
    email: res.body.user.email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    organizationId: res.body.activeOrganizationId,
  };
}

/**
 * Adds a second user to an existing organisation at the given role, by creating
 * the membership directly. Invitation acceptance has its own suite; using it
 * here would couple every RBAC test to that flow.
 */
export async function addMember(
  organizationId: string,
  role: Role,
  email = uniqueEmail(role.toLowerCase()),
): Promise<TestActor> {
  const registered = await registerActor({ email, organizationName: `Throwaway ${email}` });

  // Drop the throwaway org so the user has exactly one membership and requests
  // need no X-Org-Id header.
  await prisma.membership.deleteMany({ where: { userId: registered.userId } });
  await prisma.organization.deleteMany({ where: { id: registered.organizationId } });
  await prisma.membership.create({ data: { userId: registered.userId, organizationId, role } });

  // Re-login so the token belongs to a live session with the new membership.
  const res = await request(app())
    .post('/api/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD })
    .expect(200);

  return {
    userId: registered.userId,
    email,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    organizationId,
  };
}

export function auth(actor: TestActor) {
  return { Authorization: `Bearer ${actor.accessToken}` };
}
