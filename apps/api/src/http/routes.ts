import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { organizationsRouter } from '../modules/organizations/organizations.routes';
import { invitationsRouter } from '../modules/invitations/invitations.routes';

/**
 * The v1 surface. Later phases mount their routers here:
 *   audiences, leads, suppression (Phase 2) · ai (Phase 3)
 *   integrations, templates, campaigns, unsubscribe, webhooks (Phase 4)
 *   linkedin (Phase 5) · inbox, analytics (Phase 7) · billing, privacy (Phase 9)
 */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/invitations', invitationsRouter);
