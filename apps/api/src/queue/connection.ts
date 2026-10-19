import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Redis is optional in Phase 1: the API runs without it (in-memory rate limits,
 * no queue consumers). It becomes required in Phase 2, when job processors
 * arrive. Keeping the dependency optional here means a new contributor can run
 * the API with Postgres alone.
 */
export const redisEnabled = Boolean(env.REDIS_URL);

let client: Redis | null = null;

const baseOptions: RedisOptions = {
  // BullMQ requires this to be null; it also stops ioredis from throwing on a
  // slow restart of a local container.
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
};

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, baseOptions);
    client.on('error', (err) => logger.warn({ err }, 'redis error'));
    client.on('connect', () => logger.info('redis connected'));
  }
  return client;
}

export async function assertRedisReachable(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  await redis.ping();
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}
