import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../../src/openapi/spec';

describe('openapi document', () => {
  // Runs without a database: a spec that drifts from the routes is a defect we
  // can catch cheaply on every PR.
  const documented = Object.keys(openApiSpec.paths);

  it('documents every Phase 1 route', () => {
    expect(documented).toEqual(
      expect.arrayContaining([
        '/auth/register',
        '/auth/login',
        '/auth/refresh',
        '/auth/logout',
        '/auth/logout-all',
        '/auth/me',
        '/auth/change-password',
        '/organizations/current',
        '/organizations/current/members',
        '/organizations/current/members/{userId}',
        '/organizations/current/transfer-ownership',
        '/organizations/current/audit-logs',
        '/invitations',
        '/invitations/{id}',
        '/invitations/accept/{token}',
      ]),
    );
  });

  it('declares bearer auth on protected operations', () => {
    const me = openApiSpec.paths['/auth/me'].get;
    expect(me.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiSpec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('leaves public routes unauthenticated', () => {
    expect(openApiSpec.paths['/auth/login'].post).not.toHaveProperty('security');
    expect(openApiSpec.paths['/invitations/accept/{token}'].get).not.toHaveProperty('security');
  });
});
