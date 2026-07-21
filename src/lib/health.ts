import { prisma } from '../db/client';
import { redis } from './redisClient';

export interface HealthStatus {
  ok: boolean;
  db: 'up' | 'down';
  redis: 'up' | 'down';
}

export async function checkHealth(): Promise<HealthStatus> {
  const [dbUp, redisUp] = await Promise.all([checkDb(), checkRedis()]);
  return {
    ok: dbUp && redisUp,
    db: dbUp ? 'up' : 'down',
    redis: redisUp ? 'up' : 'down',
  };
}

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
