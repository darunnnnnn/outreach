import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { hashToken } from '../../src/lib/crypto';
import { closeDatabase, hasDatabase, resetDatabase } from '../helpers/db';
import { STRONG_PASSWORD, addMember, app, auth, registerActor, uniqueEmail } from '../helpers/api';

/** Extracts the token from the acceptUrl the API returns while mail is only logged. */
function tokenOf(acceptUrl: string): string {
  return decodeURIComponent(new URL(acceptUrl).searchParams.get('token')!);
}

describe.skipIf(!hasDatabase)('invitations', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it('creates an invitation, stores only a token hash, and audits it', async () => {
    const owner = await registerActor({ organizationName: 'Nordwind' });
    const email = uniqueEmail('invitee');

    const res = await request(app())
      .post('/api/v1/invitations')
      .set(auth(owner))
      .send({ email: email.toUpperCase(), role: 'MEMBER' })
      .expect(201);

    expect(res.body.email).toBe(email.toLowerCase());
    expect(res.body.status).toBe('PENDING');
    expect(res.body.invitedByName).toBe('Test Owner');
    expect(res.body.acceptUrl).toContain('/accept-invite?token=');

    const token = tokenOf(res.body.acceptUrl);
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'invitation.created' },
    });
    expect(entry.metadata).toMatchObject({ email: email.toLowerCase(), role: 'MEMBER' });
  });

  it('defaults the role to MEMBER', async () => {
    const owner = await registerActor();
    const res = await request(app())
      .post('/api/v1/invitations')
      .set(auth(owner))
      .send({ email: uniqueEmail() })
      .expect(201);
    expect(res.body.role).toBe('MEMBER');
  });

  it('refuses to invite an existing member', async () => {
    const owner = await registerActor();
    const member = await addMember(owner.organizationId, 'MEMBER');

    const res = await request(app())
      .post('/api/v1/invitations')
      .set(auth(owner))
      .send({ email: member.email })
      .expect(409);
    expect(res.body.error.details.email).toBe('Already a member');
  });

  it('re-inviting a pending address issues a fresh token and kills the old one', async () => {
    const owner = await registerActor();
    const email = uniqueEmail();

    const first = await request(app())
      .post('/api/v1/invitations')
      .set(auth(owner))
      .send({ email, role: 'MEMBER' })
      .expect(201);

    const second = await request(app())
      .post('/api/v1/invitations')
      .set(auth(owner))
      .send({ email, role: 'ADMIN' })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.body.role).toBe('ADMIN');
    expect(await prisma.invitation.count()).toBe(1);

    await request(app()).get(`/api/v1/invitations/accept/${tokenOf(first.body.acceptUrl)}`).expect(404);
    await request(app())
      .get(`/api/v1/invitations/accept/${tokenOf(second.body.acceptUrl)}`)
      .expect(200);
  });

  describe('inspect', () => {
    it('describes the invitation and whether an account must be created', async () => {
      const owner = await registerActor({ organizationName: 'Nordwind' });
      const email = uniqueEmail();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email, role: 'VIEWER' })
        .expect(201);

      const res = await request(app())
        .get(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .expect(200);

      expect(res.body).toMatchObject({
        email,
        role: 'VIEWER',
        organizationName: 'Nordwind',
        invitedByName: 'Test Owner',
        requiresAccount: true,
      });
    });

    it('reports requiresAccount=false when the address already has an account', async () => {
      const owner = await registerActor();
      const existing = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: existing.email })
        .expect(201);

      const res = await request(app())
        .get(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .expect(200);
      expect(res.body.requiresAccount).toBe(false);
    });

    it('404s on an unknown token', async () => {
      await request(app())
        .get('/api/v1/invitations/accept/this-token-does-not-exist-at-all')
        .expect(404);
    });

    it('409s on an expired invitation and marks it EXPIRED', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);

      await prisma.invitation.update({
        where: { id: invite.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app())
        .get(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .expect(409);
      expect(res.body.error.message).toMatch(/expired/i);
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: invite.body.id } })).status,
      ).toBe('EXPIRED');
    });
  });

  describe('accept', () => {
    it('creates the account, the membership, and signs the new user in', async () => {
      const owner = await registerActor({ organizationName: 'Nordwind' });
      const email = uniqueEmail('newcomer');
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email, role: 'ADMIN' })
        .expect(201);

      const res = await request(app())
        .post(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .send({ name: 'New Comer', password: STRONG_PASSWORD })
        .expect(200);

      expect(res.body.organizationName).toBe('Nordwind');
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.accessToken).toBeTypeOf('string');

      // The returned token works immediately, with the invited role.
      const me = await request(app())
        .get('/api/v1/auth/me')
        .set({ Authorization: `Bearer ${res.body.accessToken}` })
        .expect(200);
      expect(me.body.memberships[0]).toMatchObject({
        organizationId: owner.organizationId,
        role: 'ADMIN',
      });

      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.body.id } });
      expect(row.status).toBe('ACCEPTED');
      expect(row.acceptedAt).not.toBeNull();

      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);
    });

    it('requires name and password when no account exists', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);

      const res = await request(app())
        .post(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .send({})
        .expect(422);

      expect(res.body.error.details).toMatchObject({
        name: expect.any(String),
        password: expect.any(String),
      });
      expect(await prisma.membership.count({ where: { organizationId: owner.organizationId } })).toBe(1);
    });

    it('requires an existing user to be signed in, and ignores any password supplied', async () => {
      const owner = await registerActor();
      const existing = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: existing.email, role: 'MEMBER' })
        .expect(201);
      const token = tokenOf(invite.body.acceptUrl);

      // Anonymous attempt, even with a password, must not touch the account.
      const anon = await request(app())
        .post(`/api/v1/invitations/accept/${token}`)
        .send({ name: 'Impostor', password: 'AttackerChosen99' })
        .expect(401);
      expect(anon.body.error.message).toMatch(/sign in/i);

      await request(app())
        .post('/api/v1/auth/login')
        .send({ email: existing.email, password: STRONG_PASSWORD })
        .expect(200);

      await request(app())
        .post(`/api/v1/invitations/accept/${token}`)
        .set(auth(existing))
        .send({})
        .expect(200);

      expect(await prisma.membership.count({ where: { userId: existing.userId } })).toBe(2);
    });

    it('refuses acceptance by a different signed-in user', async () => {
      const owner = await registerActor();
      const invited = await registerActor();
      const someoneElse = await registerActor();

      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: invited.email })
        .expect(201);

      await request(app())
        .post(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .set(auth(someoneElse))
        .send({})
        .expect(403);
    });

    it('cannot be accepted twice', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);
      const token = tokenOf(invite.body.acceptUrl);

      await request(app())
        .post(`/api/v1/invitations/accept/${token}`)
        .send({ name: 'Once', password: STRONG_PASSWORD })
        .expect(200);

      await request(app())
        .post(`/api/v1/invitations/accept/${token}`)
        .send({ name: 'Twice', password: STRONG_PASSWORD })
        .expect(409);
    });

    it('audits acceptance with whether an account was created', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);

      await request(app())
        .post(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .send({ name: 'New', password: STRONG_PASSWORD })
        .expect(200);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'invitation.accepted' },
      });
      expect(entry.metadata).toMatchObject({ accountCreated: true });
      expect(entry.organizationId).toBe(owner.organizationId);
    });
  });

  describe('revoke', () => {
    it('revokes a pending invitation and invalidates its token', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);
      const token = tokenOf(invite.body.acceptUrl);

      await request(app()).delete(`/api/v1/invitations/${invite.body.id}`).set(auth(owner)).expect(204);

      await request(app()).get(`/api/v1/invitations/accept/${token}`).expect(404);
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: invite.body.id } })).status,
      ).toBe('REVOKED');
      await prisma.auditLog.findFirstOrThrow({ where: { action: 'invitation.revoked' } });
    });

    it('cannot revoke an already accepted invitation', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);

      await request(app())
        .post(`/api/v1/invitations/accept/${tokenOf(invite.body.acceptUrl)}`)
        .send({ name: 'New', password: STRONG_PASSWORD })
        .expect(200);

      await request(app())
        .delete(`/api/v1/invitations/${invite.body.id}`)
        .set(auth(owner))
        .expect(409);
    });
  });

  describe('list', () => {
    it('reports a lapsed pending invitation as EXPIRED', async () => {
      const owner = await registerActor();
      const invite = await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);
      await prisma.invitation.update({
        where: { id: invite.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app()).get('/api/v1/invitations').set(auth(owner)).expect(200);
      expect(res.body.data[0].status).toBe('EXPIRED');
    });

    it('never exposes the accept URL or token hash in the list', async () => {
      const owner = await registerActor();
      await request(app())
        .post('/api/v1/invitations')
        .set(auth(owner))
        .send({ email: uniqueEmail() })
        .expect(201);

      const res = await request(app()).get('/api/v1/invitations').set(auth(owner)).expect(200);
      expect(res.body.data[0].acceptUrl).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('tokenHash');
    });
  });
});
