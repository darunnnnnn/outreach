import { Router } from 'express';
import { z } from 'zod';
import { acceptInvitationSchema, createInvitationSchema, cuidSchema } from '@outreach/shared';
import { asyncHandler } from '../../http/asyncHandler';
import { authenticate, optionalAuthenticate } from '../../http/middleware/authenticate';
import { invitationLimiter } from '../../http/middleware/rateLimit';
import { requireRole, withOrg } from '../../http/middleware/withOrg';
import { validate } from '../../http/middleware/validate';
import * as controller from './invitations.controller';

export const invitationsRouter = Router();

const tokenParams = z.object({ token: z.string().min(16).max(256) });

// Public accept routes are declared before the authenticated middleware below,
// since someone accepting an invitation may have no account at all yet.
invitationsRouter.get(
  '/accept/:token',
  validate({ params: tokenParams }),
  asyncHandler(controller.inspect),
);

invitationsRouter.post(
  '/accept/:token',
  optionalAuthenticate,
  validate({ params: tokenParams, body: acceptInvitationSchema }),
  asyncHandler(controller.accept),
);

invitationsRouter.use(authenticate, withOrg);

invitationsRouter.post(
  '/',
  requireRole('ADMIN'),
  invitationLimiter,
  validate({ body: createInvitationSchema }),
  asyncHandler(controller.create),
);

invitationsRouter.get('/', requireRole('ADMIN'), asyncHandler(controller.list));

invitationsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: z.object({ id: cuidSchema }) }),
  asyncHandler(controller.revoke),
);
