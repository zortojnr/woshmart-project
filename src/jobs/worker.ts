// Composition root: wires the job-name -> handler dispatch and starts the BullMQ
// Worker. No new service/process — runs in the same Node process as the Express
// server (CLAUDE.md rule 10: no new infrastructure beyond what's scoped).
import type { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { handleAutoCloseJob } from './autoClose.job';
import { AUTO_CLOSE_JOB_NAME, PAYMENT_ABANDON_JOB_NAME, PAYMENT_REMINDER_JOB_NAME, QUOTE_TIMEOUT_JOB_NAME } from './jobIds';
import { createWorker } from './queue';
import { handlePaymentAbandonJob, handlePaymentReminderJob, handleQuoteTimeoutJob } from './sessionTimeout.job';

const HANDLERS: Record<string, (job: Job) => Promise<void>> = {
  [QUOTE_TIMEOUT_JOB_NAME]: handleQuoteTimeoutJob,
  [PAYMENT_REMINDER_JOB_NAME]: handlePaymentReminderJob,
  [PAYMENT_ABANDON_JOB_NAME]: handlePaymentAbandonJob,
  [AUTO_CLOSE_JOB_NAME]: handleAutoCloseJob,
};

export function startJobsWorker() {
  return createWorker(async (job: Job) => {
    const handler = HANDLERS[job.name];
    if (!handler) {
      // Not a "fail the job and retry" situation — an unknown job name means something
      // scheduled work this worker was never built to handle, not a transient error.
      logger.error({ jobId: job.id, name: job.name }, 'No handler registered for job name — dropping');
      return;
    }
    await handler(job);
  });
}
