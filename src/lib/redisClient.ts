import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

// Shared Redis connection — reused by /health and, from Phase 6, BullMQ.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: false,
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection error');
});
