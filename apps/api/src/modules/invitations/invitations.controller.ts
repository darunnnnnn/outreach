import type { Request, Response } from 'express';
import type { AcceptInvitationInput, CreateInvitationInput } from '@outreach/shared';
import { isProduction } from '../../config/env';
import { requireRequestContext } from '../../http/context';
import { REFRESH_COOKIE } from '../auth/auth.controller';
import * as service from './invitations.service';

export async function create(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  const invitation = await service.createInvitation(ctx, req.body as CreateInvitationInput);
  res.status(201).json(invitation);
}

export async function list(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  res.json({ data: await service.listInvitations(ctx) });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const ctx = requireRequestContext(req.ctx);
  await service.revokeInvitation(ctx, req.params.id as string);
  res.status(204).end();
}

export async function inspect(req: Request, res: Response): Promise<void> {
  res.json(await service.inspectInvitation(req.params.token as string));
}

export async function accept(req: Request, res: Response): Promise<void> {
  const result = await service.acceptInvitation(
    req.params.token as string,
    req.body as AcceptInvitationInput,
    { ip: req.ip, userAgent: req.header('user-agent') },
    req.auth?.userId,
  );

  // A newly created account is signed in straight away; an existing user was
  // already authenticated, so there is no new session to hand out.
  if (result.session) {
    res.cookie(REFRESH_COOKIE, result.session.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/v1/auth',
      expires: result.session.refreshTokenExpiresAt,
    });
  }

  res.status(200).json({
    organizationId: result.organizationId,
    organizationName: result.organizationName,
    role: result.role,
    ...(result.session
      ? {
          accessToken: result.session.accessToken,
          expiresIn: result.session.expiresIn,
          refreshToken: result.session.refreshToken,
        }
      : {}),
  });
}
