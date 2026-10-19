import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { closeDatabase, hasDatabase, resetDatabase } from '../helpers/db';
import { addMember, app, auth, registerActor, uniqueEmail } from '../helpers/api';

/**
 * Cross-tenant isolation. Every resource route added in a later phase gets a
 * case here: this is the suite that would catch a query missing its
 * `organizationId` predicate.
 */
describe.skipIf(!hasDatabase)('cross-tenant isolation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('scopes the organisation endpoint to the caller’s own org', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    const beta = await registerActor({ organizationName: 'Beta' });

    const forAlpha = await request(app())
      .get('/api/v1/organizations/current')
      .set(auth(alpha))
      .expect(200);
    const forBeta = await request(app())
      .get('/api/v1/organizations/current')
      .set(auth(beta))
      .expect(200);

    expect(forAlpha.body.name).toBe('Alpha');
    expect(forBeta.body.name).toBe('Beta');
    expect(forAlpha.body.id).not.toBe(forBeta.body.id);
  });

  it('refuses an X-Org-Id the caller is not a member of', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    const beta = await registerActor({ organizationName: 'Beta' });

    const res = await request(app())
      .get('/api/v1/organizations/current')
      .set(auth(alpha))
      .set({ 'X-Org-Id': beta.organizationId })
      .expect(403);

    // The message must not confirm whether that organisation exists.
    expect(res.body.error.message).toBe('You are not a member of this organization');

    const nonexistent = await request(app())
      .get('/api/v1/organizations/current')
      .set(auth(alpha))
      .set({ 'X-Org-Id': 'org_does_not_exist' })
      .expect(403);
    expect(nonexistent.body.error.message).toBe(res.body.error.message);
  });

  it('never lists members of another organisation', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    await addMember(alpha.organizationId, 'MEMBER', uniqueEmail('alpha-member'));
    const beta = await registerActor({ organizationName: 'Beta' });

    const res = await request(app())
      .get('/api/v1/organizations/current/members')
      .set(auth(beta))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(beta.userId);
  });

  it('cannot change or remove a member of another organisation', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    const alphaMember = await addMember(alpha.organizationId, 'MEMBER');
    const beta = await registerActor({ organizationName: 'Beta' });

    await request(app())
      .patch(`/api/v1/organizations/current/members/${alphaMember.userId}`)
      .set(auth(beta))
      .send({ role: 'ADMIN' })
      .expect(404);

    await request(app())
      .delete(`/api/v1/organizations/current/members/${alphaMember.userId}`)
      .set(auth(beta))
      .expect(404);

    const unchanged = await prisma.membership.findUniqueOrThrow({
      where: {
        userId_organizationId: {
          userId: alphaMember.userId,
          organizationId: alpha.organizationId,
        },
      },
    });
    expect(unchanged.role).toBe('MEMBER');
  });

  it('cannot revoke another organisation’s invitation', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    const beta = await registerActor({ organizationName: 'Beta' });

    const invite = await request(app())
      .post('/api/v1/invitations')
      .set(auth(alpha))
      .send({ email: uniqueEmail('invitee'), role: 'MEMBER' })
      .expect(201);

    await request(app())
      .delete(`/api/v1/invitations/${invite.body.id}`)
      .set(auth(beta))
      .expect(404);

    expect(
      (await prisma.invitation.findUniqueOrThrow({ where: { id: invite.body.id } })).status,
    ).toBe('PENDING');
  });

  it('shows each organisation only its own audit log', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    const beta = await registerActor({ organizationName: 'Beta' });

    const res = await request(app())
      .get('/api/v1/organizations/current/audit-logs')
      .set(auth(beta))
      .expect(200);

    const orgIds = new Set(
      (
        await prisma.auditLog.findMany({
          where: { id: { in: res.body.data.map((r: { id: string }) => r.id) } },
          select: { organizationId: true },
        })
      ).map((r) => r.organizationId),
    );
    expect([...orgIds]).toEqual([beta.organizationId]);
    expect(orgIds.has(alpha.organizationId)).toBe(false);
  });

  it('does not leak another organisation’s invitation list', async () => {
    const alpha = await registerActor({ organizationName: 'Alpha' });
    await request(app())
      .post('/api/v1/invitations')
      .set(auth(alpha))
      .send({ email: uniqueEmail('secret'), role: 'MEMBER' })
      .expect(201);

    const beta = await registerActor({ organizationName: 'Beta' });
    const res = await request(app()).get('/api/v1/invitations').set(auth(beta)).expect(200);
    expect(res.body.data).toHaveLength(0);
  });
});
