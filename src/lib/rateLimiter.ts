// Rate limiting core (docs/BUILD_SCRIPT.md Phase 7 item 1). Fixed-window counter via
// Redis INCR + PEXPIRE — reuses the existing BullMQ Redis connection, no new
// infrastructure. Distributed-safe across multiple instances, which a per-process
// counter would not be.
import { redis } from './redisClient';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.pexpire(redisKey, windowMs);
  }

  if (count <= limit) {
    return { allowed: true, retryAfterMs: 0 };
  }

  const ttl = await redis.pttl(redisKey);
  return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs };
}
