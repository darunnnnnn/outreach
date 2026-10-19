import { Router } from 'express';
import { z } from 'zod';
import {
  auditLogQuerySchema,
  cuidSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
} from '@outreach/shared';
import { asyncHandler } from '../../http/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate';
import { requireRole, withOrg } from '../../http/middleware/withOrg';
import { validate } from '../../http/middleware/validate';
import * as controller from './organizations.controller';

export const organizationsRouter = Router();

// Every route below is authenticated and scoped to one organisation. The order
// matters: authenticate -> withOrg -> requireRole.
organizationsRouter.use(authenticate, withOrg);

const userIdParams = z.object({ userId: cuidSchema });

organizationsRouter.get(
  '/current',
  requireRole('VIEWER'),
  asyncHandler(controller.getCurrent),
);

organizationsRouter.patch(
  '/current',
  requireRole('ADMIN'),
  validate({ body: updateOrganizationSchema }),
  asyncHandler(controller.updateCurrent),
);

organizationsRouter.get(
  '/current/members',
  requireRole('VIEWER'),
  asyncHandler(controller.listMembers),
);

organizationsRouter.patch(
  '/current/members/:userId',
  requireRole('ADMIN'),
  validate({ params: userIdParams, body: updateMemberRoleSchema }),
  asyncHandler(controller.updateMemberRole),
);

organizationsRouter.delete(
  '/current/members/:userId',
  requireRole('ADMIN'),
  validate({ params: userIdParams }),
  asyncHandler(controller.removeMember),
);

organizationsRouter.post(
  '/current/transfer-ownership',
  requireRole('OWNER'),
  validate({ body: transferOwnershipSchema }),
  asyncHandler(controller.transferOwnership),
);

organizationsRouter.get(
  '/current/audit-logs',
  requireRole('ADMIN'),
  validate({ query: auditLogQuerySchema }),
  asyncHandler(controller.listAuditLogs),
);
