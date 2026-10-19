import { Queue, type JobsOptions } from 'bullmq';
import { getRedis, redisEnabled } from './connection';
import { logger } from '../config/logger';

/**
 * Queue names are fixed now so the worker entrypoint, dashboards and alerts do
 * not have to be reworked as each phase adds its processors.
 */
export const QUEUE_NAMES = {
  leadImport: 'lead.import',
  leadEnrich: 'lead.enrich',
  aiGenerate: 'ai.generate',
  campaignTick: 'campaign.tick',
  outreachSend: 'outreach.send',
  inboxSync: 'inbox.sync',
  analyticsRollup: 'analytics.rollup',
  retention: 'retention',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Defaults chosen so a retry storm cannot amplify a provider outage, and so a
 * failed job is kept long enough to be inspected. `jobId` is supplied by callers
 * as a deterministic key, which is what makes re-enqueueing a no-op.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue | null {
  if (!redisEnabled) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  const connection = getRedis();
  if (!connection) return null;
  const queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  queues.set(name, queue);
  return queue;
}

/**
 * Enqueue with a deterministic id. Returns false when Redis is not configured,
 * so Phase 1 callers can degrade instead of failing a request — from Phase 2
 * the processors are mandatory and `assertRedisReachable` gates readiness.
 */
export async function enqueue(
  name: QueueName,
  jobId: string,
  payload: Record<string, unknown>,
  options: JobsOptions = {},
): Promise<boolean> {
  const queue = getQueue(name);
  if (!queue) {
    logger.warn({ queue: name, jobId }, 'redis not configured; job not enqueued');
    return false;
  }
  await queue.add(name, payload, { jobId, ...options });
  return true;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
