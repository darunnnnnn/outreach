import type { Request, Response } from 'express';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '@outreach/shared';
import { isProduction } from '../../config/env';
import { requireAuthContext } from '../../http/context';
import { BadRequestError } from '../../http/errors';
import * as authService from './auth.service';
import type { AuthResult, RequestMeta } from './auth.service';

export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.header('user-agent') };
}

/**
 * The refresh token goes to browsers as an httpOnly cookie scoped to the auth
 * routes, so page JavaScript cannot read it and it is not attached to any other
 * request. Non-browser clients use the copy in the response body instead.
 */
function setRefreshCookie(res: Response, result: AuthResult): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: result.refreshTokenExpiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

function presentedRefreshToken(req: Request): string | undefined {
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  return fromCookie && fromCookie.length > 0 ? fromCookie : undefined;
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput, meta(req));
  setRefreshCookie(res, result);
  res.status(201).json({ ...result.response, refreshToken: result.refreshToken });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput, meta(req));
  setRefreshCookie(res, result);
  res.status(200).json({ ...result.response, refreshToken: result.refreshToken });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = presentedRefreshToken(req);
  if (!token) throw new BadRequestError('No refresh token supplied');
  const result = await authService.refresh(token, meta(req));
  setRefreshCookie(res, result);
  res.status(200).json({ ...result.response, refreshToken: result.refreshToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req.auth);
  await authService.logout(presentedRefreshToken(req), auth.userId, meta(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req.auth);
  const sessionsRevoked = await authService.logoutAll(auth.userId, meta(req));
  clearRefreshCookie(res);
  res.status(200).json({ sessionsRevoked });
}

export async function me(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req.auth);
  res.status(200).json(await authService.me(auth.userId));
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req.auth);
  const { name } = req.body as UpdateProfileInput;
  res.status(200).json(await authService.updateProfile(auth.userId, name, meta(req)));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const auth = requireAuthContext(req.auth);
  const result = await authService.changePassword(
    auth.userId,
    auth.sessionId,
    req.body as ChangePasswordInput,
    meta(req),
  );
  res.status(200).json(result);
}
