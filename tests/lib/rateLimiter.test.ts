// Rate limiting core (docs/BUILD_SCRIPT.md Phase 7 item 1): a Redis fixed-window
// counter. Exercised against the real Redis instance (same as health.test.ts and the
// job tests) rather than mocked, since the whole point is the actual INCR/PEXPIRE
// behavior — unique per-test keys, cleaned up afterward, keep this isolated from other
// suites sharing the same Redis instance.
import { afterAll, describe, expect, it } from 'vitest';
import { checkRateLimit } from '../../src/lib/rateLimiter';
import { redis } from '../../src/lib/redisClient';

describe('checkRateLimit', () => {
  const testKeys: string[] = [];

  afterAll(async () => {
    if (testKeys.length > 0) {
      await redis.del(...testKeys.map((k) => `ratelimit:${k}`));
    }
  });

  it('allows requests up to the limit within the window', async () => {
    const key = `test-${Date.now()}-a`;
    testKeys.push(key);

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, 3, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it('denies once the limit is exceeded, with a positive retryAfterMs', async () => {
    const key = `test-${Date.now()}-b`;
    testKeys.push(key);

    await checkRateLimit(key, 2, 60_000);
    await checkRateLimit(key, 2, 60_000);
    const result = await checkRateLimit(key, 2, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('tracks separate keys independently', async () => {
    const keyA = `test-${Date.now()}-c1`;
    const keyB = `test-${Date.now()}-c2`;
    testKeys.push(keyA, keyB);

    await checkRateLimit(keyA, 1, 60_000);
    const resultA = await checkRateLimit(keyA, 1, 60_000);
    const resultB = await checkRateLimit(keyB, 1, 60_000);

    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it('resets once the window expires', async () => {
    // A generous window relative to real Redis round-trip latency in this test
    // environment — a tight window risks the key expiring between the two calls
    // themselves, which would falsely look like a reset-on-time-not-passing bug.
    const key = `test-${Date.now()}-d`;
    testKeys.push(key);
    const windowMs = 3000;

    await checkRateLimit(key, 1, windowMs);
    const deniedWithinWindow = await checkRateLimit(key, 1, windowMs);
    expect(deniedWithinWindow.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, windowMs + 500));
    const allowedAfterWindow = await checkRateLimit(key, 1, windowMs);
    expect(allowedAfterWindow.allowed).toBe(true);
  }, 15_000);
});
