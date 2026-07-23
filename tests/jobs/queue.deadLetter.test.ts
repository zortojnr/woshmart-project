// Dead-letter handling (docs/BUILD_SCRIPT.md Phase 6 item 4): a job that exhausts its
// retry attempts must be logged loudly, not retried indefinitely and not silently
// dropped. Tests logJobFailure directly against a fake Job rather than driving a real
// BullMQ job through Redis and its actual exponential-backoff delays.
//
// Also covers the Phase 7 item 8 addition: a dead-lettered payment-abandon job (the one
// job type whose permanent failure is a real payment/data-integrity risk) triggers the
// urgent alert email; anything else does not.
import type { Job } from 'bullmq';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/lib/logger';
import type { logJobFailure as LogJobFailureFn } from '../../src/jobs/queue';

const sendUrgentAlertEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/alertEmail', () => ({
  sendUrgentAlertEmail: sendUrgentAlertEmailMock,
}));

let logJobFailure: typeof LogJobFailureFn;

beforeAll(async () => {
  ({ logJobFailure } = await import('../../src/jobs/queue'));
});

function fakeJob(overrides: Partial<{ name: string; attemptsMade: number; attempts: number }>): Job {
  return {
    id: 'job-1',
    name: overrides.name ?? 'generic-job',
    data: { orderId: 'order-1' },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job;
}

beforeEach(() => {
  sendUrgentAlertEmailMock.mockClear();
});

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

describe('logJobFailure — urgent alert email on payment/data-integrity dead-letters', () => {
  it('sends the urgent alert email when a payment-abandon job dead-letters', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    logJobFailure(fakeJob({ name: 'payment-abandon', attemptsMade: 3, attempts: 3 }), new Error('boom'));

    expect(sendUrgentAlertEmailMock).toHaveBeenCalledTimes(1);
    expect(sendUrgentAlertEmailMock.mock.calls[0]?.[0]).toMatch(/payment-abandon/);

    errorSpy.mockRestore();
  });

  it('does not send the urgent alert email for a dead-lettered job outside the payment/data-integrity list', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    logJobFailure(fakeJob({ name: 'quote-timeout', attemptsMade: 3, attempts: 3 }), new Error('boom'));

    expect(sendUrgentAlertEmailMock).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('does not send the urgent alert email while retries remain, even for payment-abandon', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    logJobFailure(fakeJob({ name: 'payment-abandon', attemptsMade: 1, attempts: 3 }), new Error('transient'));

    expect(sendUrgentAlertEmailMock).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
