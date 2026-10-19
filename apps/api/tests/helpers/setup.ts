/**
 * Runs before any test module is imported, so it is the only safe place to set
 * environment variables that `src/config/env.ts` reads at import time.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.MAIL_TRANSPORT = 'console';

// 32 zero bytes, base64 — valid shape, no secret. Only exercises the AES helpers.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

// Keep bcrypt fast in tests; production cost comes from BCRYPT_ROUNDS in .env.
process.env.BCRYPT_ROUNDS = '4';

// Integration suites use TEST_DATABASE_URL and never the development database.
if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
  // Deliberately NOT falling back to DATABASE_URL: the suite truncates every
  // table, and doing that to someone's dev data once is once too often.
  process.env.TEST_DATABASE_URL = '';
}
