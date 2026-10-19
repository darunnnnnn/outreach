import pino from 'pino';
import { env, isDevelopment } from './env';

/**
 * Anything on this list is replaced with [Redacted] before a line is written.
 * Treat it as append-only: a secret that reaches the log reaches the aggregator,
 * and from there it cannot be recalled.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'apiKey',
  'secret',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[Redacted]' },
  base: { service: 'api', env: env.NODE_ENV },
  // Pretty output is a dev convenience only; deployed environments emit JSON for
  // the aggregator. `pino-pretty` is intentionally not a dependency — piping
  // through it locally (`npm run dev:api | npx pino-pretty`) keeps prod lean.
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const logLevelIsDebug = isDevelopment && env.LOG_LEVEL === 'debug';
