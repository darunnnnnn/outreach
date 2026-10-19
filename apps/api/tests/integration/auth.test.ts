import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { hashToken } from '../../src/lib/crypto';
import { closeDatabase, hasDatabase, resetDatabase } from '../helpers/db';
import { STRONG_PASSWORD, app, auth, registerActor, uniqueEmail } from '../helpers/api';

describe.skipIf(!hasDatabase)('auth', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await closeDatabase();
  });

  describe('POST /auth/register', () => {
    it('creates user, organisation and OWNER membership atomically', async () => {
      const email = uniqueEmail('founder');
      const res = await request(app())
        .post('/api/v1/auth/register')
        .send({
          name: 'Ada Lovelace',
          email: email.toUpperCase(),
          password: STRONG_PASSWORD,
          organizationName: 'Analytical Engines',
          timezone: 'Europe/Berlin',
        })
        .expect(201);

      expect(res.body.user.email).toBe(email.toLowerCase());
      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.memberships).toHaveLength(1);
      expect(res.body.memberships[0].role).toBe('OWNER');
      expect(res.body.activeOrganizationId).toBe(res.body.memberships[0].organizationId);

      const membership = await prisma.membership.findFirstOrThrow({
        where: { userId: res.body.user.id },
        include: { organization: true },
      });
      expect(membership.role).toBe('OWNER');
      expect(membership.organization.timezone).toBe('Europe/Berlin');
      expect(membership.organization.slug).toMatch(/^analytical-engines-[0-9a-f]{6}$/);
    });

    it('never stores the password in plaintext', async () => {
      const actor = await registerActor();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
      expect(user.passwordHash).not.toContain(STRONG_PASSWORD);
      expect(user.passwordHash.startsWith('$2')).toBe(true);
    });

    it('sets an httpOnly refresh cookie scoped to the auth routes', async () => {
      const res = await request(app())
        .post('/api/v1/auth/register')
        .send({
          name: 'Ada',
          email: uniqueEmail(),
          password: STRONG_PASSWORD,
          organizationName: 'Cookie Co',
        })
        .expect(201);

      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('refresh_token='),
      );
      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('rejects a duplicate email with 409', async () => {
      const email = uniqueEmail();
      await request(app())
        .post('/api/v1/auth/register')
        .send({ name: 'A', email, password: STRONG_PASSWORD, organizationName: 'First' })
        .expect(201);

      const res = await request(app())
        .post('/api/v1/auth/register')
        .send({ name: 'B', email, password: STRONG_PASSWORD, organizationName: 'Second' })
        .expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
      expect(await prisma.organization.count({ where: { name: 'Second' } })).toBe(0);
    });

    it('rejects a weak password with a field-keyed 422', async () => {
      const res = await request(app())
        .post('/api/v1/auth/register')
        .send({
          name: 'A',
          email: uniqueEmail(),
          password: 'password123',
          organizationName: 'Weak',
        })
        .expect(422);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.password).toBeTypeOf('string');
      expect(res.body.error.requestId).toBeTypeOf('string');
      expect(await prisma.user.count()).toBe(0);
    });

    it('writes an auth.registered audit entry', async () => {
      const actor = await registerActor();
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.registered', actorUserId: actor.userId },
      });
      expect(entry.organizationId).toBe(actor.organizationId);
      expect(entry.targetType).toBe('organization');
    });
  });

  describe('POST /auth/login', () => {
    it('authenticates a valid user and records the login', async () => {
      const email = uniqueEmail();
      await registerActor({ email });

      const res = await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      expect(res.body.accessToken).toBeTypeOf('string');
      expect(res.body.user.lastLoginAt).toBeTypeOf('string');
      expect(await prisma.auditLog.count({ where: { action: 'auth.login' } })).toBe(1);
    });

    it('returns the same 401 for an unknown email and a wrong password', async () => {
      const email = uniqueEmail();
      await registerActor({ email });

      const wrongPassword = await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: 'NotThePassword9' })
        .expect(401);

      const unknownEmail = await request(app())
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('ghost'), password: STRONG_PASSWORD })
        .expect(401);

      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
      expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('audits failed logins with a reason but no credential material', async () => {
      const email = uniqueEmail();
      await registerActor({ email });
      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: 'NotThePassword9' })
        .expect(401);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'auth.login_failed' },
      });
      expect(entry.metadata).toMatchObject({ reason: 'bad_password' });
      expect(JSON.stringify(entry.metadata)).not.toContain('NotThePassword9');
    });

    it('refuses a disabled account', async () => {
      const email = uniqueEmail();
      const actor = await registerActor({ email });
      await prisma.user.update({ where: { id: actor.userId }, data: { isActive: false } });

      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const actor = await registerActor();

      const res = await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: actor.refreshToken })
        .expect(200);

      expect(res.body.refreshToken).not.toBe(actor.refreshToken);
      expect(res.body.accessToken).toBeTypeOf('string');

      const old = await prisma.session.findUniqueOrThrow({
        where: { tokenHash: hashToken(actor.refreshToken) },
      });
      expect(old.revokedAt).not.toBeNull();
      expect(old.replacedById).not.toBeNull();
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      const actor = await registerActor();
      const rotated = await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: actor.refreshToken })
        .expect(200);

      // Replay the original: the classic stolen-token signal.
      await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: actor.refreshToken })
        .expect(401);

      // The token issued by the legitimate rotation is now dead too.
      await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);

      const live = await prisma.session.count({
        where: { userId: actor.userId, revokedAt: null },
      });
      expect(live).toBe(0);

      const alert = await prisma.auditLog.findFirst({
        where: { action: 'auth.refresh_reuse_detected' },
      });
      expect(alert).not.toBeNull();
      expect(alert?.metadata).toMatchObject({ severity: 'high' });
    });

    it('accepts the token from the httpOnly cookie', async () => {
      const email = uniqueEmail();
      await registerActor({ email });
      const login = await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      await request(app())
        .post('/api/v1/auth/refresh')
        .set('Cookie', login.headers['set-cookie'] as unknown as string[])
        .send({})
        .expect(200);
    });

    it('rejects an expired refresh token', async () => {
      const actor = await registerActor();
      await prisma.session.update({
        where: { tokenHash: hashToken(actor.refreshToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: actor.refreshToken })
        .expect(401);
    });

    it('rejects a request with no token at all', async () => {
      const res = await request(app()).post('/api/v1/auth/refresh').send({}).expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('session validity', () => {
    it('invalidates the access token as soon as its session is revoked', async () => {
      const actor = await registerActor();
      await request(app()).get('/api/v1/auth/me').set(auth(actor)).expect(200);

      await request(app())
        .post('/api/v1/auth/logout')
        .set(auth(actor))
        .send({ refreshToken: actor.refreshToken })
        .expect(204);

      // Same still-unexpired JWT, but the session behind it is gone.
      await request(app()).get('/api/v1/auth/me').set(auth(actor)).expect(401);
    });

    it('rejects a missing or malformed Authorization header', async () => {
      await request(app()).get('/api/v1/auth/me').expect(401);
      await request(app()).get('/api/v1/auth/me').set({ Authorization: 'Basic abc' }).expect(401);
      await request(app()).get('/api/v1/auth/me').set({ Authorization: 'Bearer' }).expect(401);
    });

    it('logout-all revokes every session for the user', async () => {
      const email = uniqueEmail();
      const actor = await registerActor({ email });
      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      const res = await request(app()).post('/api/v1/auth/logout-all').set(auth(actor)).expect(200);

      expect(res.body.sessionsRevoked).toBe(2);
      expect(
        await prisma.session.count({ where: { userId: actor.userId, revokedAt: null } }),
      ).toBe(0);
    });
  });

  describe('GET/PATCH /auth/me', () => {
    it('returns the user with their memberships', async () => {
      const actor = await registerActor();
      const res = await request(app()).get('/api/v1/auth/me').set(auth(actor)).expect(200);

      expect(res.body.user.id).toBe(actor.userId);
      expect(res.body.memberships[0].role).toBe('OWNER');
      expect(res.body.activeOrganizationId).toBe(actor.organizationId);
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('updates the display name', async () => {
      const actor = await registerActor();
      const res = await request(app())
        .patch('/api/v1/auth/me')
        .set(auth(actor))
        .send({ name: 'Ada King' })
        .expect(200);

      expect(res.body.name).toBe('Ada King');
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and revokes other sessions', async () => {
      const email = uniqueEmail();
      const actor = await registerActor({ email });
      const other = await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);

      const res = await request(app())
        .post('/api/v1/auth/change-password')
        .set(auth(actor))
        .send({ currentPassword: STRONG_PASSWORD, newPassword: 'AnotherGoodOne42' })
        .expect(200);

      expect(res.body.sessionsRevoked).toBe(1);

      // The other session's refresh token no longer works...
      await request(app())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: other.body.refreshToken })
        .expect(401);
      // ...while the session that made the change keeps working.
      await request(app()).get('/api/v1/auth/me').set(auth(actor)).expect(200);

      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: 'AnotherGoodOne42' })
        .expect(200);
      await request(app())
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(401);
    });

    it('requires the correct current password', async () => {
      const actor = await registerActor();
      await request(app())
        .post('/api/v1/auth/change-password')
        .set(auth(actor))
        .send({ currentPassword: 'WrongPassword11', newPassword: 'AnotherGoodOne42' })
        .expect(401);
    });

    it('refuses to reuse the same password', async () => {
      const actor = await registerActor();
      const res = await request(app())
        .post('/api/v1/auth/change-password')
        .set(auth(actor))
        .send({ currentPassword: STRONG_PASSWORD, newPassword: STRONG_PASSWORD })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });
});
