import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProduction, isTestEnv } from './config/env';
import { logger } from './config/logger';
import { assertDatabaseReachable } from './db/prisma';
import { assertRedisReachable, redisEnabled } from './queue/connection';
import { apiRouter } from './http/routes';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler';
import { globalLimiter } from './http/middleware/rateLimit';
import { requestId } from './http/middleware/requestId';
import { openApiSpec } from './openapi/spec';

/**
 * Builds the app without binding a port, so the integration suite can drive it
 * through Supertest in-process. `index.ts` is the only place that listens.
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer the client IP arrives in X-Forwarded-For; rate limits
  // and audit records are worthless without it.
  app.set('trust proxy', isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    helmet({
      // The API serves JSON plus Swagger UI; the SPA is a separate origin with
      // its own CSP, so the default cross-origin policies here would only break
      // the docs page.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        logger.warn({ origin }, 'blocked cors origin');
        return callback(null, false);
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  if (!isTestEnv) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as Request).requestId,
        customProps: (req) => ({
          userId: (req as Request).auth?.userId,
          organizationId: (req as Request).ctx?.organizationId,
        }),
        autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
      }),
    );
  }

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), env: env.NODE_ENV });
  });

  // Readiness fails when a dependency is down, so the load balancer stops
  // sending traffic to a replica that cannot serve it.
  app.get('/readyz', async (_req: Request, res: Response) => {
    const checks: Record<string, 'ok' | 'unavailable' | 'skipped'> = {
      database: 'ok',
      redis: redisEnabled ? 'ok' : 'skipped',
    };
    try {
      await assertDatabaseReachable();
    } catch {
      checks.database = 'unavailable';
    }
    if (redisEnabled) {
      try {
        await assertRedisReachable();
      } catch {
        checks.redis = 'unavailable';
      }
    }
    const ready = !Object.values(checks).includes('unavailable');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  app.get('/openapi.json', (_req: Request, res: Response) => res.json(openApiSpec));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec as unknown as Record<string, unknown>, {
      customSiteTitle: 'OutreachOS API',
    }),
  );

  app.use('/api/v1', globalLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
