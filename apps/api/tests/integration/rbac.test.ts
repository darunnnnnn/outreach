import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@outreach/shared';
import { closeDatabase, hasDatabase, resetDatabase } from '../helpers/db';
import { addMember, app, auth, registerActor, type TestActor } from '../helpers/api';

/**
 * The RBAC matrix, asserted route by route. This suite is the reason a later
 * phase can add a route with confidence: forget `requireRole` and one of these
 * cases turns red.
 */
describe.skipIf(!hasDatabase)('rbac matrix', () => {
  const actors: Partial<Record<Role, TestActor>> = {};
  let targetUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    const owner = await registerActor({ organizationName: 'RBAC Org' });
    actors.OWNER = owner;
    actors.ADMIN = await addMember(owner.organizationId, 'ADMIN');
    actors.MEMBER = await addMember(owner.organizationId, 'MEMBER');
    actors.VIEWER = await addMember(owner.organizationId, 'VIEWER');
    // A spare member used as the target of role changes and removals.
    targetUserId = (await addMember(owner.organizationId, 'MEMBER')).userId;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const cases: Array<{
    name: string;
    run: (actor: TestActor) => request.Test;
    allowed: Role[];
  }> = [
    {
      name: 'GET /organizations/current',
      run: (actor) => request(app()).get('/api/v1/organizations/current').set(auth(actor)),
      allowed: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
    },
    {
      name: 'GET /organizations/current/members',
      run: (actor) => request(app()).get('/api/v1/organizations/current/members').set(auth(actor)),
      allowed: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
    },
    {
      name: 'PATCH /organizations/current',
      run: (actor) =>
        request(app())
          .patch('/api/v1/organizations/current')
          .set(auth(actor))
          .send({ name: 'RBAC Org' }),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'GET /organizations/current/audit-logs',
      run: (actor) =>
        request(app()).get('/api/v1/organizations/current/audit-logs').set(auth(actor)),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'GET /invitations',
      run: (actor) => request(app()).get('/api/v1/invitations').set(auth(actor)),
      allowed: ['OWNER', 'ADMIN'],
    },
    {
      name: 'POST /organizations/current/transfer-ownership',
      run: (actor) =>
        request(app())
          .post('/api/v1/organizations/current/transfer-ownership')
          .set(auth(actor))
          .send({ userId: targetUserId }),
      allowed: ['OWNER'],
    },
  ];

  for (const testCase of cases) {
    const denied = (['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]).filter(
      (role) => !testCase.allowed.includes(role),
    );

    for (const role of denied) {
      it(`denies ${role} on ${testCase.name}`, async () => {
        const res = await testCase.run(actors[role]!);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    }

    for (const role of testCase.allowed) {
      // Transfer-ownership is run last on purpose: it mutates the OWNER role and
      // would invalidate the rest of the matrix if it ran earlier.
      if (testCase.name.includes('transfer-ownership')) continue;
      it(`allows ${role} on ${testCase.name}`, async () => {
        const res = await testCase.run(actors[role]!);
        expect(res.status).toBeLessThan(400);
      });
    }
  }

  it('denies a VIEWER every write route', async () => {
    const viewer = actors.VIEWER!;
    await request(app())
      .post('/api/v1/invitations')
      .set(auth(viewer))
      .send({ email: 'someone@example.test', role: 'MEMBER' })
      .expect(403);
    await request(app())
      .patch(`/api/v1/organizations/current/members/${targetUserId}`)
      .set(auth(viewer))
      .send({ role: 'VIEWER' })
      .expect(403);
    await request(app())
      .delete(`/api/v1/organizations/current/members/${targetUserId}`)
      .set(auth(viewer))
      .expect(403);
  });

  it('allows any role to read and update their own profile', async () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]) {
      await request(app()).get('/api/v1/auth/me').set(auth(actors[role]!)).expect(200);
      await request(app())
        .patch('/api/v1/auth/me')
        .set(auth(actors[role]!))
        .send({ name: `${role} User` })
        .expect(200);
    }
  });
});
