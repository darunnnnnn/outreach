import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationError } from '../errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Detected structurally rather than with `instanceof` alone. Schemas come from
 * `@outreach/shared`, so under some module-resolution paths the error is built
 * by a different `zod` module instance than the one imported here and the
 * `instanceof` check silently fails — which turns a 422 into a 500.
 */
function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'ZodError' &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

/** `{ "email": "Must be a valid email address", "steps.0.delayHours": "..." }` */
function fieldErrors(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    details[key] ??= issue.message;
  }
  return details;
}

/**
 * Parses body/query/params with Zod and replaces the raw values with the parsed
 * output, so handlers receive coerced, defaulted, unknown-key-stripped data and
 * cannot accidentally read the untrusted original.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params ?? {});
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query ?? {});
        // Express 4's `req.query` is a getter in some configurations; attach the
        // parsed result where handlers can always reach it.
        req.valid = { ...(req.valid ?? {}), query: parsed };
      }
      next();
    } catch (err) {
      if (isZodError(err)) {
        next(new ValidationError(fieldErrors(err)));
        return;
      }
      next(err);
    }
  };
}

/** Typed accessor for a query object parsed by `validate({ query })`. */
export function validatedQuery<T>(req: Request): T {
  return req.valid?.query as T;
}
