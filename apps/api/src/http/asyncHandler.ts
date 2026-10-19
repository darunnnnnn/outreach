import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not forward a rejected promise to the error handler, so every
 * async route is wrapped. Without this a thrown `AppError` becomes a hung
 * request instead of a 4xx.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
