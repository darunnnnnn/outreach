import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { assertDatabaseReachable, disconnectPrisma } from './db/prisma';
import { closeQueues } from './queue/queues';
import { closeRedis, redisEnabled } from './queue/connection';

async function main(): Promise<void> {
  // Fail before accepting traffic rather than returning 500s afterwards.
  await assertDatabaseReachable();
  logger.info('database connection ok');
  if (!redisEnabled) {
    logger.warn('REDIS_URL is not set: rate limits are per-process and no jobs will run');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, docs: `${env.API_URL}/docs` },
      'api listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Stop accepting connections, let in-flight requests finish, then release
    // the pools. The timer is the backstop for a wedged connection.
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out; exiting');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeQueues();
    await closeRedis();
    await disconnectPrisma();
    clearTimeout(forceExit);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception; exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start api');
  process.exit(1);
});
