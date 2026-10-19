import { Worker, type Job } from 'bullmq';
import { logger } from './config/logger';
import { assertDatabaseReachable, disconnectPrisma } from './db/prisma';
import { closeRedis, getRedis } from './queue/connection';
import { QUEUE_NAMES, type QueueName } from './queue/queues';

/**
 * The worker entrypoint. Phase 1 registers no processors — the queues exist but
 * nothing is enqueued yet. It ships now so that the Docker entrypoint, graceful
 * shutdown and connection handling are settled before Phase 2 adds the first
 * processor (`lead.import`).
 *
 * Each phase registers its processors in `processors` below:
 *   Phase 2: lead.import, lead.enrich
 *   Phase 3: ai.generate
 *   Phase 4: campaign.tick, outreach.send, inbox.sync
 *   Phase 7: analytics.rollup
 *   Phase 9: retention
 */
type Processor = (job: Job) => Promise<unknown>;

const processors: Partial<Record<QueueName, Processor>> = {};

async function main(): Promise<void> {
  await assertDatabaseReachable();

  const connection = getRedis();
  if (!connection) {
    logger.fatal('REDIS_URL is required to run the worker');
    process.exit(1);
  }

  const workers = Object.entries(processors).map(([name, processor]) => {
    const worker = new Worker(name, processor as Processor, {
      connection,
      // Conservative by default: provider rate limits, not CPU, are the
      // constraint for almost every job this platform runs.
      concurrency: 5,
    });
    worker.on('failed', (job, err) =>
      logger.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err }, 'job failed'),
    );
    worker.on('completed', (job) => logger.debug({ queue: name, jobId: job.id }, 'job completed'));
    return worker;
  });

  if (workers.length === 0) {
    logger.info(
      { queues: Object.values(QUEUE_NAMES) },
      'worker started with no processors registered (expected until Phase 2)',
    );
  } else {
    logger.info({ queues: workers.map((w) => w.name) }, 'worker started');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    // `close()` waits for the active job so a half-sent campaign step is never
    // abandoned mid-flight; BullMQ re-queues anything still pending.
    await Promise.all(workers.map((w) => w.close()));
    await closeRedis();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start worker');
  process.exit(1);
});
