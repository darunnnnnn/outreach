import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { closeDatabase, hasDatabase, resetDatabase } from '../helpers/db';
import { addMember, app, auth, registerActor } from '../helpers/api';

describe.skipIf(!hasDatabase)('organizations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('returns the active organisation with a member count', async () => {
    const owner = await registerActor({ organizationName: 'Nordwind Textiles' });
    await addMember(owner.organizationId, 'MEMBER');

    const res = await request(app())
      .get('/api/v1/organizations/current')
      .set(auth(owner))
      .expect(200);

    expect(res.body.name).toBe('Nordwind Textiles');
    expect(res.body.memberCount).toBe(2);
    expect(res.body.plan).toBe('free');
  });

  it('updates name, timezone and settings, and audits the change', async () => {
    const owner = await registerActor();

    const res = await request(app())
      .patch('/api/v1/organizations/current')
      .set(auth(owner))
      .send({ name: 'Renamed GmbH', timezone: 'Europe/Amsterdam', settings: { a: 1 } })
      .expect(200);

    expect(res.body.name).toBe('Renamed GmbH');
    expect(res.body.timezone).toBe('Europe/Amsterdam');
    expect(res.body.settings).toEqual({ a: 1 });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'org.updated' } });
    expect(entry.metadata).toMatchObject({ fields: ['name', 'timezone', 'settings'] });
  });

  it('rejects an empty patch', async () => {
    const owner = await registerActor();
    await request(app())
      .patch('/api/v1/organizations/current')
      .set(auth(owner))
      .send({})
      .expect(422);
  });

  describe('members', () => {
    it('lists members with roles and flags the caller', async () => {
      const owner = await registerActor();
      const member = await addMember(owner.organizationId, 'MEMBER');

      const res = await request(app())
        .get('/api/v1/organizations/current/members')
        .set(auth(owner))
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      const self = res.body.data.find((m: { userId: string }) => m.userId === owner.userId);
      const other = res.body.data.find((m: { userId: string }) => m.userId === member.userId);
      expect(self.isSelf).toBe(true);
      expect(self.role).toBe('OWNER');
      expect(other.role).toBe('MEMBER');
      expect(other.isSelf).toBe(false);
    });

    it('changes a member role and audits from/to', async () => {
      const owner = await registerActor();
      const member = await addMember(owner.organizationId, 'MEMBER');

      await request(app())
        .patch(`/api/v1/organizations/current/members/${member.userId}`)
        .set(auth(owner))
        .send({ role: 'ADMIN' })
        .expect(200);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: member.userId,
            organizationId: owner.organizationId,
          },
        },
      });
      expect(membership.role).toBe('ADMIN');

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'member.role_changed' },
      });
      expect(entry.metadata).toMatchObject({ from: 'MEMBER', to: 'ADMIN' });
    });

    it('will not assign OWNER through a role change', async () => {
      const owner = await registerActor();
      const member = await addMember(owner.organizationId, 'MEMBER');

      const res = await request(app())
        .patch(`/api/v1/organizations/current/members/${member.userId}`)
        .set(auth(owner))
        .send({ role: 'OWNER' })
        .expect(422);
      expect(res.body.error.details.role).toBeTypeOf('string');
    });

    it('refuses to demote the last owner', async () => {
      const owner = await registerActor();
      const admin = await addMember(owner.organizationId, 'ADMIN');

      const res = await request(app())
        .patch(`/api/v1/organizations/current/members/${owner.userId}`)
        .set(auth(admin))
        .send({ role: 'MEMBER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // Even the owner cannot demote themselves while they are the only one.
      const selfRes = await request(app())
        .patch(`/api/v1/organizations/current/members/${owner.userId}`)
        .set(auth(owner))
        .send({ role: 'ADMIN' })
        .expect(409);
      expect(selfRes.body.error.code).toBe('CONFLICT');
    });

    it('refuses to remove the last owner', async () => {
      const owner = await registerActor();
      const res = await request(app())
        .delete(`/api/v1/organizations/current/members/${owner.userId}`)
        .set(auth(owner))
        .expect(409);
      expect(res.body.error.message).toMatch(/last owner/i);
    });

    it('lets an admin remove a member and audits it', async () => {
      const owner = await registerActor();
      const admin = await addMember(owner.organizationId, 'ADMIN');
      const member = await addMember(owner.organizationId, 'MEMBER');

      await request(app())
        .delete(`/api/v1/organizations/current/members/${member.userId}`)
        .set(auth(admin))
        .expect(204);

      expect(
        await prisma.membership.count({ where: { organizationId: owner.organizationId } }),
      ).toBe(2);
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'member.removed' } });
      expect(entry.metadata).toMatchObject({ removedRole: 'MEMBER' });
    });

    it('does not let an admin remove an owner', async () => {
      const owner = await registerActor();
      const second = await addMember(owner.organizationId, 'ADMIN');
      await prisma.membership.updateMany({
        where: { userId: second.userId, organizationId: owner.organizationId },
        data: { role: 'OWNER' },
      });
      const admin = await addMember(owner.organizationId, 'ADMIN');

      await request(app())
        .delete(`/api/v1/organizations/current/members/${owner.userId}`)
        .set(auth(admin))
        .expect(403);
    });

    it('returns 404 for a user who is not a member', async () => {
      const owner = await registerActor();
      const outsider = await registerActor();

      await request(app())
        .patch(`/api/v1/organizations/current/members/${outsider.userId}`)
        .set(auth(owner))
        .send({ role: 'MEMBER' })
        .expect(404);
    });
  });

  describe('transfer ownership', () => {
    it('promotes the target and steps the previous owner down to ADMIN', async () => {
      const owner = await registerActor();
      const member = await addMember(owner.organizationId, 'MEMBER');

      const res = await request(app())
        .post('/api/v1/organizations/current/transfer-ownership')
        .set(auth(owner))
        .send({ userId: member.userId })
        .expect(200);

      const roles = Object.fromEntries(
        res.body.data.map((m: { userId: string; role: string }) => [m.userId, m.role]),
      );
      expect(roles[member.userId]).toBe('OWNER');
      expect(roles[owner.userId]).toBe('ADMIN');
      expect(
        await prisma.membership.count({
          where: { organizationId: owner.organizationId, role: 'OWNER' },
        }),
      ).toBe(1);
    });

    it('is refused for an admin', async () => {
      const owner = await registerActor();
      const admin = await addMember(owner.organizationId, 'ADMIN');
      const member = await addMember(owner.organizationId, 'MEMBER');

      await request(app())
        .post('/api/v1/organizations/current/transfer-ownership')
        .set(auth(admin))
        .send({ userId: member.userId })
        .expect(403);
    });

    it('rejects transferring to yourself', async () => {
      const owner = await registerActor();
      await request(app())
        .post('/api/v1/organizations/current/transfer-ownership')
        .set(auth(owner))
        .send({ userId: owner.userId })
        .expect(409);
    });
  });

  describe('audit logs', () => {
    it('paginates, filters by action, and resolves the actor name', async () => {
      const owner = await registerActor();
      await request(app())
        .patch('/api/v1/organizations/current')
        .set(auth(owner))
        .send({ name: 'One' })
        .expect(200);
      await request(app())
        .patch('/api/v1/organizations/current')
        .set(auth(owner))
        .send({ name: 'Two' })
        .expect(200);

      const all = await request(app())
        .get('/api/v1/organizations/current/audit-logs')
        .set(auth(owner))
        .expect(200);
      expect(all.body.meta.total).toBeGreaterThanOrEqual(3);
      expect(all.body.data[0].actorName).toBe('Test Owner');

      const filtered = await request(app())
        .get('/api/v1/organizations/current/audit-logs?action=org.updated&pageSize=1')
        .set(auth(owner))
        .expect(200);
      expect(filtered.body.data).toHaveLength(1);
      expect(filtered.body.meta.total).toBe(2);
      expect(filtered.body.meta.hasMore).toBe(true);
    });

    it('is refused for a member', async () => {
      const owner = await registerActor();
      const member = await addMember(owner.organizationId, 'MEMBER');
      await request(app())
        .get('/api/v1/organizations/current/audit-logs')
        .set(auth(member))
        .expect(403);
    });
  });

  describe('org selection', () => {
    it('requires X-Org-Id when the user belongs to several organisations', async () => {
      const first = await registerActor();
      const secondOrg = await prisma.organization.create({
        data: { name: 'Second', slug: `second-${Date.now()}` },
      });
      await prisma.membership.create({
        data: { userId: first.userId, organizationId: secondOrg.id, role: 'ADMIN' },
      });

      const ambiguous = await request(app())
        .get('/api/v1/organizations/current')
        .set(auth(first))
        .expect(403);
      expect(ambiguous.body.error.message).toMatch(/X-Org-Id/);

      const chosen = await request(app())
        .get('/api/v1/organizations/current')
        .set(auth(first))
        .set({ 'X-Org-Id': secondOrg.id })
        .expect(200);
      expect(chosen.body.id).toBe(secondOrg.id);
    });

    it('refuses a user with no membership at all', async () => {
      const actor = await registerActor();
      await prisma.membership.deleteMany({ where: { userId: actor.userId } });

      const res = await request(app())
        .get('/api/v1/organizations/current')
        .set(auth(actor))
        .expect(403);
      expect(res.body.error.message).toMatch(/do not belong/i);
    });
  });
});
