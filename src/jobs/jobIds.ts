// Pure job-naming/timing constants (docs/PRD.md §8) shared between
// order.statemachine.ts — which schedules/cancels jobs on every status write, the
// single choke point per CLAUDE.md rule 4 — and the job handler files, which need the
// same names/ids to schedule (quote-timeout) or register their processors. Deliberately
// has zero imports: the job handler files need order.statemachine.ts's
// transitionOrderStatus, so if this file imported statemachine.ts (or anything that
// does), and statemachine.ts imported this file, that would still be fine on its own —
// but statemachine.ts must NOT import the job handler files themselves, or the two
// would form a cycle. Keeping this file import-free keeps that boundary unambiguous.

export const QUOTE_TIMEOUT_JOB_NAME = 'quote-timeout';
export const PAYMENT_REMINDER_JOB_NAME = 'payment-reminder';
export const PAYMENT_ABANDON_JOB_NAME = 'payment-abandon';
export const AUTO_CLOSE_JOB_NAME = 'auto-close';

// docs/PRD.md §8.
export const QUOTE_TIMEOUT_DELAY_MS = 30 * 60 * 1000;
export const PAYMENT_REMINDER_DELAY_MS = 45 * 60 * 1000;
export const PAYMENT_ABANDON_DELAY_MS = 60 * 60 * 1000;
export const AUTO_CLOSE_DELAY_MS = 24 * 60 * 60 * 1000;

// One deterministic jobId per (job type, entity) — BullMQ silently no-ops an `add()`
// whose jobId already exists in the queue, which is what makes re-scheduling on a
// retried webhook/keyword/admin call safe rather than a duplicate (CLAUDE.md rule 6).
//
// Uses "-" as the separator, not ":" — BullMQ rejects custom jobIds containing a colon
// outright ("Custom Id cannot contain :", since it uses colon-delimited keys
// internally in Redis). Every scheduleJob/cancelJob call was silently failing on this
// before it was caught — the id is never parsed back apart anywhere in this codebase,
// so the extra hyphens already inside a UUID orderId create no ambiguity.
export function quoteTimeoutJobId(phoneNumber: string): string {
  return `${QUOTE_TIMEOUT_JOB_NAME}-${phoneNumber}`;
}
export function paymentReminderJobId(orderId: string): string {
  return `${PAYMENT_REMINDER_JOB_NAME}-${orderId}`;
}
export function paymentAbandonJobId(orderId: string): string {
  return `${PAYMENT_ABANDON_JOB_NAME}-${orderId}`;
}
export function autoCloseJobId(orderId: string): string {
  return `${AUTO_CLOSE_JOB_NAME}-${orderId}`;
}
