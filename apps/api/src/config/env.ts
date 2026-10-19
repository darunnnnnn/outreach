import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repo-root .env (single source of truth for both apps), then any
// app-local override. Values already in process.env always win, so a CI or
// container environment is never overwritten by a stray file.
const repoRoot = path.resolve(__dirname, '../../../..');
for (const file of [path.join(repoRoot, '.env'), path.resolve(__dirname, '../../.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file });
}

const isTest = process.env.NODE_ENV === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: isTest
    ? z.string().min(1).optional()
    : z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),

  // A weak default is tolerable only for `NODE_ENV=test`, where nothing issued
  // by the process outlives the run. Everywhere else this must be set.
  JWT_SECRET: isTest
    ? z.string().min(32).default('test-only-secret-at-least-32-characters-long')
    : z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(isTest ? 4 : 12),

  // 32 bytes base64. Unused in Phase 1; required from Phase 4 (OAuth token storage).
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === '' || Buffer.from(v, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    }),

  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('OutreachOS <no-reply@example.com>'),
  SMTP_URL: z.string().optional(),

  RATE_LIMIT_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Fail fast and loudly: a half-configured process is worse than no process.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTestEnv = env.NODE_ENV === 'test';

if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
  throw new Error('MAIL_TRANSPORT=smtp requires SMTP_URL');
}
