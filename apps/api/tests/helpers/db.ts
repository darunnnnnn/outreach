import { prisma } from '../../src/db/prisma';

/**
 * Integration tests need a real Postgres — mocking Prisma would test the mock,
 * not the constraints and transactions that carry most of the tenancy
 * guarantees. When TEST_DATABASE_URL is absent the suites skip loudly rather
 * than passing vacuously; CI always sets it.
 *
 * Use with vitest: `describe.skipIf(!hasDatabase)('...', ...)`.
 */
export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);

/** Truncates every Phase 1 table. CASCADE covers the FK order. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "invitations", "sessions", "memberships", "organizations", "users" RESTART IDENTITY CASCADE',
  );
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}

if (!hasDatabase) {
  // Printed once per run so a green local result is never mistaken for a full one.
  console.warn(
    '\n  [!] TEST_DATABASE_URL is not set — integration suites are SKIPPED.' +
      '\n      Start Postgres (docker compose up -d), create the test database, set' +
      '\n      TEST_DATABASE_URL, then: npm run db:migrate:deploy && npm run test:integration\n',
  );
}
