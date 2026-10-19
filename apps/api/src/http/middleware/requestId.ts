import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

/**
 * Correlation id for every log line, error body and (later) queue job, so a
 * customer-reported failure can be traced from the browser through the worker.
 * An inbound id from a trusted proxy is reused; otherwise we mint one.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADER);
  const id =
    inbound && /^[A-Za-z0-9_.:-]{8,128}$/.test(inbound)
      ? inbound
      : `req_${crypto.randomBytes(12).toString('hex')}`;
  req.requestId = id;
  res.setHeader(HEADER, id);
  next();
}
