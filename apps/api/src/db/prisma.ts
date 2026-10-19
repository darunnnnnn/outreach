import { PrismaClient } from '@prisma/client';
import { env, isDevelopment } from '../config/env';
import { logger } from '../config/logger';

/**
 * One client per process. `globalThis` caching keeps `tsx watch` from opening a
 * new connection pool on every reload, which otherwise exhausts Postgres
 * connections within a few minutes of editing.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDevelopment ? ['warn', 'error'] : ['error'],
    datasources: {
      db: {
        url:
          env.NODE_ENV === 'test'
            ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL ?? '')
            : (env.DATABASE_URL ?? ''),
      },
    },
  });

if (isDevelopment) globalForPrisma.prisma = prisma;

export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function assertDatabaseReachable(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.warn({ err }, 'prisma disconnect failed');
  }
}
