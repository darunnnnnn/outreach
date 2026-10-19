import { env } from '../config/env';

/**
 * Hand-maintained for Phase 1 — the surface is small enough that a generated
 * document would cost more than it saves. From Phase 2 this is generated from
 * the shared Zod schemas (`zod-to-openapi`), which is why request bodies here
 * mirror those schema names exactly.
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const json = (ref: string) => ({
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'OutreachOS API',
    version: '1.0.0-phase1',
    description: [
      'AI-powered multichannel outreach automation platform.',
      '',
      'Phase 1 covers authentication, organisations, membership and audit logs.',
      'Lead, AI, campaign and channel endpoints arrive in later phases — see',
      'docs/05-api-design.md for the planned surface.',
      '',
      'Authentication: send `Authorization: Bearer <accessToken>`. When a user',
      'belongs to more than one organisation, also send `X-Org-Id`.',
    ].join('\n'),
  },
  servers: [{ url: `${env.API_URL}/api/v1`, description: env.NODE_ENV }],
  tags: [
    { name: 'Auth', description: 'Registration, sessions and the current user' },
    { name: 'Organizations', description: 'Organisation settings, members and audit log' },
    { name: 'Invitations', description: 'Inviting and onboarding team members' },
    { name: 'Platform', description: 'Health and documentation' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    parameters: {
      OrgId: {
        name: 'X-Org-Id',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Active organisation. Required when the user has several memberships.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: [
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
                ],
              },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: { type: 'string' } },
              requestId: { type: 'string' },
            },
          },
        },
      },
      Role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
      SessionUser: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      MembershipSummary: {
        type: 'object',
        properties: {
          organizationId: { type: 'string' },
          organizationName: { type: 'string' },
          organizationSlug: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          expiresIn: { type: 'integer', description: 'Access token lifetime in seconds' },
          refreshToken: {
            type: 'string',
            description: 'Also set as an httpOnly cookie scoped to /api/v1/auth',
          },
          user: { $ref: '#/components/schemas/SessionUser' },
          memberships: {
            type: 'array',
            items: { $ref: '#/components/schemas/MembershipSummary' },
          },
          activeOrganizationId: { type: 'string' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'password', 'organizationName'],
        properties: {
          name: { type: 'string', maxLength: 120 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 10, maxLength: 200 },
          organizationName: { type: 'string', maxLength: 120 },
          timezone: { type: 'string', default: 'UTC' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      RefreshRequest: {
        type: 'object',
        properties: {
          refreshToken: {
            type: 'string',
            description: 'Omit when the httpOnly refresh cookie is sent instead',
          },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 10 },
        },
      },
      MeResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/SessionUser' },
          memberships: {
            type: 'array',
            items: { $ref: '#/components/schemas/MembershipSummary' },
          },
          activeOrganizationId: { type: ['string', 'null'] },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          timezone: { type: 'string' },
          plan: { type: 'string' },
          settings: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
          memberCount: { type: 'integer' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
          joinedAt: { type: 'string', format: 'date-time' },
          lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
          isSelf: { type: 'boolean' },
        },
      },
      MemberList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
        },
      },
      Invitation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
          status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] },
          invitedByName: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          acceptUrl: {
            type: 'string',
            description: 'Returned only while mail is logged rather than delivered (local dev)',
          },
        },
      },
      PublicInvitation: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
          organizationName: { type: 'string' },
          invitedByName: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          requiresAccount: { type: 'boolean' },
        },
      },
      AuditLogPage: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                action: { type: 'string' },
                actorUserId: { type: ['string', 'null'] },
                actorName: { type: ['string', 'null'] },
                targetType: { type: ['string', 'null'] },
                targetId: { type: ['string', 'null'] },
                metadata: { type: 'object', additionalProperties: true },
                ip: { type: ['string', 'null'] },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
              hasMore: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create a user, their organisation and an OWNER membership',
        requestBody: { required: true, ...json('RegisterRequest') },
        responses: {
          201: { description: 'Created', ...json('AuthResponse') },
          409: errorResponse('Email already registered'),
          422: errorResponse('Validation failed'),
          429: errorResponse('Rate limited'),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange credentials for tokens',
        requestBody: { required: true, ...json('LoginRequest') },
        responses: {
          200: { description: 'Authenticated', ...json('AuthResponse') },
          401: errorResponse('Invalid email or password'),
          429: errorResponse('Rate limited'),
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token and issue a new access token',
        description:
          'Presenting an already-rotated token revokes the entire token family and returns 401.',
        requestBody: json('RefreshRequest'),
        responses: {
          200: { description: 'Rotated', ...json('AuthResponse') },
          400: errorResponse('No refresh token supplied'),
          401: errorResponse('Invalid, expired or reused refresh token'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the presented refresh token',
        security: [{ bearerAuth: [] }],
        responses: { 204: { description: 'Logged out' }, 401: errorResponse('Unauthenticated') },
      },
    },
    '/auth/logout-all': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke every session for the current user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Revoked',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sessionsRevoked: { type: 'integer' } },
                },
              },
            },
          },
          401: errorResponse('Unauthenticated'),
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user and memberships',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'OK', ...json('MeResponse') },
          401: errorResponse('Unauthenticated'),
        },
      },
      patch: {
        tags: ['Auth'],
        summary: 'Update the current user profile',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string', maxLength: 120 } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated', ...json('SessionUser') },
          401: errorResponse('Unauthenticated'),
          422: errorResponse('Validation failed'),
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password and revoke other sessions',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, ...json('ChangePasswordRequest') },
        responses: {
          200: {
            description: 'Changed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { sessionsRevoked: { type: 'integer' } },
                },
              },
            },
          },
          401: errorResponse('Current password incorrect'),
          409: errorResponse('New password matches the current one'),
        },
      },
    },
    '/organizations/current': {
      get: {
        tags: ['Organizations'],
        summary: 'Active organisation',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        responses: {
          200: { description: 'OK', ...json('Organization') },
          403: errorResponse('Not a member'),
        },
      },
      patch: {
        tags: ['Organizations'],
        summary: 'Update organisation settings (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  timezone: { type: 'string' },
                  settings: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated', ...json('Organization') },
          403: errorResponse('Requires ADMIN'),
        },
      },
    },
    '/organizations/current/members': {
      get: {
        tags: ['Organizations'],
        summary: 'List members',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        responses: {
          200: { description: 'OK', ...json('MemberList') },
          403: errorResponse('Not a member'),
        },
      },
    },
    '/organizations/current/members/{userId}': {
      patch: {
        tags: ['Organizations'],
        summary: 'Change a member role (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OrgId' },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: { role: { type: 'string', enum: ['ADMIN', 'MEMBER', 'VIEWER'] } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated', ...json('MemberList') },
          403: errorResponse('Requires ADMIN, or OWNER to act on an owner'),
          404: errorResponse('Member not found'),
          409: errorResponse('Last owner cannot be demoted'),
        },
      },
      delete: {
        tags: ['Organizations'],
        summary: 'Remove a member (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OrgId' },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          204: { description: 'Removed' },
          403: errorResponse('Requires ADMIN, or OWNER to remove an owner'),
          404: errorResponse('Member not found'),
          409: errorResponse('Last owner cannot be removed'),
        },
      },
    },
    '/organizations/current/transfer-ownership': {
      post: {
        tags: ['Organizations'],
        summary: 'Transfer ownership to another member (OWNER only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: { userId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Transferred', ...json('MemberList') },
          403: errorResponse('Requires OWNER'),
          404: errorResponse('Member not found'),
        },
      },
    },
    '/organizations/current/audit-logs': {
      get: {
        tags: ['Organizations'],
        summary: 'Paginated audit log (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OrgId' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'actorUserId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          200: { description: 'OK', ...json('AuditLogPage') },
          403: errorResponse('Requires ADMIN'),
        },
      },
    },
    '/invitations': {
      post: {
        tags: ['Invitations'],
        summary: 'Invite someone to the organisation (ADMIN+)',
        description: 'Re-inviting a pending address issues a fresh token and extends the expiry.',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['ADMIN', 'MEMBER', 'VIEWER'], default: 'MEMBER' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Invited', ...json('Invitation') },
          403: errorResponse('Requires ADMIN'),
          409: errorResponse('Already a member'),
        },
      },
      get: {
        tags: ['Invitations'],
        summary: 'List invitations (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/OrgId' }],
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Invitation' } },
                  },
                },
              },
            },
          },
          403: errorResponse('Requires ADMIN'),
        },
      },
    },
    '/invitations/{id}': {
      delete: {
        tags: ['Invitations'],
        summary: 'Revoke a pending invitation (ADMIN+)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/OrgId' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          204: { description: 'Revoked' },
          404: errorResponse('Invitation not found'),
          409: errorResponse('Invitation is not pending'),
        },
      },
    },
    '/invitations/accept/{token}': {
      get: {
        tags: ['Invitations'],
        summary: 'Inspect an invitation before accepting (public)',
        responses: {
          200: { description: 'OK', ...json('PublicInvitation') },
          404: errorResponse('Invitation not found'),
          409: errorResponse('Already used or expired'),
        },
      },
      post: {
        tags: ['Invitations'],
        summary: 'Accept an invitation (public, or authenticated for an existing account)',
        description: [
          'If no account exists for the invited address, `name` and `password` are',
          'required and the response signs the new user in. If an account exists,',
          'the request must be authenticated as that user.',
        ].join(' '),
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  password: { type: 'string', minLength: 10 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Accepted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    organizationId: { type: 'string' },
                    organizationName: { type: 'string' },
                    role: { $ref: '#/components/schemas/Role' },
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                    expiresIn: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: errorResponse('An account exists; sign in to accept'),
          403: errorResponse('Invitation issued to a different address'),
          409: errorResponse('Already used, expired, or already a member'),
          422: errorResponse('Name and password required for a new account'),
        },
      },
    },
  },
} as const;
