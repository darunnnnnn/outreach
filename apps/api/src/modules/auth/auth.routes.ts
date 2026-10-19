import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema,
} from '@outreach/shared';
import { asyncHandler } from '../../http/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate';
import { validate } from '../../http/middleware/validate';
import {
  authEmailLimiter,
  authLimiter,
  refreshLimiter,
} from '../../http/middleware/rateLimit';
import * as controller from './auth.controller';

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  authLimiter,
  authEmailLimiter,
  validate({ body: loginSchema }),
  asyncHandler(controller.login),
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(controller.refresh),
);

authRouter.post('/logout', authenticate, asyncHandler(controller.logout));
authRouter.post('/logout-all', authenticate, asyncHandler(controller.logoutAll));

authRouter.get('/me', authenticate, asyncHandler(controller.me));

authRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateProfileSchema }),
  asyncHandler(controller.updateProfile),
);

authRouter.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);
