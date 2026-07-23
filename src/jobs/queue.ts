// BullMQ setup against Redis (docs/BUILD_SCRIPT.md Phase 6 item 1). Deliberately a leaf
// module — job-specific scheduling/handling logic lives in sessionTimeout.job.ts and
// autoClose.job.ts, both of which need order.statemachine.ts's transitionOrderStatus.
// If this file imported either of those (or order.statemachine.ts), and they imported
// this file back, that would be a real circular dependency — so this file only ever
// owns the Queue/Worker infrastructure and generic add/remove helpers, nothing domain
// -specific.
import IORedis from 'ioredis';
import { Queue, Worker, type Job, type Processor } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { sendUrgentAlertEmail } from '../lib/alertEmail';
import { PAYMENT_ABANDON_JOB_NAME } from './jobIds';

// Job names whose permanent failure represents the payment/data-integrity class of
// issue CLAUDE.md's alerting philosophy reserves urgent paging for — a dead-lettered
// payment-abandon job means an order can be stuck in awaiting_payment indefinitely with
// no automatic resolution either way. Deliberately a short, explicit list, not "every
// job" — everything else stays log/Retool-only by design.
const PAGE_ON_DEAD_LETTER = new Set<string>([PAYMENT_ABANDON_JOB_NAME]);

export const JOBS_QUEUE_NAME = 'woshmart-jobs';

// A Redis outage/DNS blip must not hang forever — ioredis's default retryStrategy keeps
// retrying indefinitely with no bound, which would leave scheduleJob/cancelJob's own
// try/catch below never actually catching anything (the awaited call just never
// settles). A capped connect timeout plus the SCHEDULE_OP_TIMEOUT_MS race in
// withTimeout() below are what actually bound this — this connection itself keeps
// ioredis's normal indefinite reconnection behavior (so it recovers on its own once
// Redis is back, no app restart needed); it's only the individual scheduleJob/cancelJob
// call that's guaranteed to give up and log within a few seconds.
function createBullConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 5_000 });
}

const SCHEDULE_OP_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export const jobsQueue = new Queue(JOBS_QUEUE_NAME, { connection: createBullConnection() });

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  // Dead-lettered jobs stay visible in Redis for manual inspection rather than being
  // auto-removed — the logged error on 'failed' below is the primary visibility
  // mechanism (docs/BUILD_SCRIPT.md Phase 6 item 4), this is just a secondary aid.
  removeOnFail: false,
};

// A scheduling/cancellation failure (Redis down, etc.) must never block the caller's
// primary write — the order/session change the caller is making has already succeeded
// by the time these run — so both are logged loudly rather than thrown, matching
// CLAUDE.md's alerting philosophy (transient infra failures don't need to interrupt the
// customer-facing or admin-facing action that triggered them).
export async function scheduleJob(
  name: string,
  jobId: string,
  data: Record<string, unknown>,
  delayMs: number,
): Promise<void> {
  try {
    await withTimeout(
      jobsQueue.add(name, data, { jobId, delay: delayMs, ...DEFAULT_JOB_OPTS }),
      SCHEDULE_OP_TIMEOUT_MS,
      'scheduleJob',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message, name, jobId }, 'Failed to schedule job');
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  try {
    await withTimeout(
      (async () => {
        const job = await jobsQueue.getJob(jobId);
        if (job) {
          await job.remove();
        }
      })(),
      SCHEDULE_OP_TIMEOUT_MS,
      'cancelJob',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message, jobId }, 'Failed to cancel job');
  }
}

// Extracted as a standalone function (rather than inlined in the 'failed' listener
// below) so the dead-letter-vs-retry decision can be unit-tested directly against a
// fake Job, without needing a real BullMQ round trip through Redis and its backoff
// delays (docs/BUILD_SCRIPT.md Phase 6 item 4).
export function logJobFailure(job: Job, err: Error): void {
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= attempts) {
    // Exhausted every retry — dead-lettered. Logged loudly (visible in monitoring)
    // rather than retried indefinitely or silently dropped.
    logger.error(
      { jobId: job.id, name: job.name, data: job.data, attemptsMade: job.attemptsMade, err: err.message },
      'Job exhausted all retry attempts — dead-lettered, needs manual review',
    );

    if (PAGE_ON_DEAD_LETTER.has(job.name)) {
      // sendUrgentAlertEmail never rejects — it logs and swallows its own failures —
      // so this is fire-and-forget from a synchronous event listener by design.
      void sendUrgentAlertEmail(
        `Job dead-lettered: ${job.name}`,
        `Job "${job.name}" (id ${job.id}) exhausted all retry attempts.\n\nLast error: ${err.message}\n\nThis job type transitions order payment state — check the order referenced in its data and resolve manually.`,
      );
    }
  } else {
    logger.warn(
      { jobId: job.id, name: job.name, attemptsMade: job.attemptsMade, err: err.message },
      'Job attempt failed, will retry with backoff',
    );
  }
}

// Composition root (src/jobs/worker.ts) builds the dispatch-by-job-name processor and
// passes it in here — this file has no knowledge of which job names exist.
export function createWorker(processor: Processor): Worker {
  const worker = new Worker(JOBS_QUEUE_NAME, processor, { connection: createBullConnection() });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    if (!job) return;
    logJobFailure(job, err);
  });

  return worker;
}
