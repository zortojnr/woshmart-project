// Dead-letter handling (docs/BUILD_SCRIPT.md Phase 6 item 4): a job that exhausts its
// retry attempts must be logged loudly, not retried indefinitely and not silently
// dropped. Tests logJobFailure directly against a fake Job rather than driving a real
// BullMQ job through Redis and its actual exponential-backoff delays.
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/lib/logger';
import { logJobFailure } from '../../src/jobs/queue';

function fakeJob(overrides: Partial<{ attemptsMade: number; attempts: number }>): Job {
  return {
    id: 'job-1',
    name: 'payment-abandon',
    data: { orderId: 'order-1' },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job;
}

describe('logJobFailure — dead-letter handling', () => {
  it('logs at error level (dead-lettered) once attemptsMade reaches the configured attempts', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    logJobFailure(fakeJob({ attemptsMade: 3, attempts: 3 }), new Error('boom'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toMatch(/exhausted all retry attempts/i);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs at warn level (will retry) while attempts remain', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    logJobFailure(fakeJob({ attemptsMade: 1, attempts: 3 }), new Error('transient'));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toMatch(/will retry/i);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
