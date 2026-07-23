// 30-min quote-abandon, 45-min payment-reminder, 60-min payment-window-abandon
// (docs/PRD.md §8). Quote-abandon is keyed by phone number — no order exists yet at
// QUOTE_PENDING (order.service.ts's createOrderFromQuote creates the order only on
// YES, never earlier per docs/TRD.md §3), so there's nothing in the orders table to
// mark ABANDONED at that point — only the session resets. The payment jobs are keyed
// by orderId, scheduled/cancelled from order.statemachine.ts (the single choke point
// for every order status write, CLAUDE.md rule 4) rather than here, to avoid a circular
// import (this file needs transitionOrderStatus for the firing/handler side below).
import type { Job } from 'bullmq';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { saveSession } from '../conversation/session.repository';
import { PAYMENT_REMINDER_MESSAGE, QUOTE_TIMEOUT_MESSAGE } from '../conversation/messages';
import { notify, sendManualMessage } from '../domain/notifications/notification.service';
import { transitionOrderStatus } from '../domain/orders/order.statemachine';
import { cancelJob, scheduleJob } from './queue';
import { QUOTE_TIMEOUT_DELAY_MS, QUOTE_TIMEOUT_JOB_NAME, quoteTimeoutJobId } from './jobIds';

// Appended to orders.notes as a marker so a duplicate firing of the reminder job (the
// only one of these four handlers with no natural status-based idempotency guard —
// see handlePaymentReminderJob) doesn't re-send the same reminder twice.
const PAYMENT_REMINDER_SENT_MARKER = '[payment-reminder-sent]';

// engine.ts calls these directly on every message that enters/leaves QUOTE_PENDING —
// scheduleJob's deterministic jobId makes re-entering QUOTE_PENDING via an unmatched
// reply a safe no-op, not a reset/duplicate of the 30-minute window.
export async function scheduleQuoteTimeoutJob(phoneNumber: string): Promise<void> {
  await scheduleJob(QUOTE_TIMEOUT_JOB_NAME, quoteTimeoutJobId(phoneNumber), { phoneNumber }, QUOTE_TIMEOUT_DELAY_MS);
}

export async function cancelQuoteTimeoutJob(phoneNumber: string): Promise<void> {
  await cancelJob(quoteTimeoutJobId(phoneNumber));
}

// Idempotent by construction: a second firing (retry, duplicate delivery) re-reads the
// session and finds it's no longer QUOTE_PENDING (this handler already moved it to
// IDLE), so it skips — no duplicate message, no duplicate reset.
export async function handleQuoteTimeoutJob(job: Job): Promise<void> {
  const { phoneNumber } = job.data as { phoneNumber: string };
  const session = await prisma.session.findUnique({ where: { phoneNumber } });

  if (!session || session.state !== 'QUOTE_PENDING') {
    logger.info(
      { phoneNumber, state: session?.state },
      'Quote-timeout fired but session is no longer QUOTE_PENDING — skipping',
    );
    return;
  }

  await saveSession(phoneNumber, 'IDLE', {});
  await sendManualMessage(phoneNumber, QUOTE_TIMEOUT_MESSAGE);
}

// Idempotent by construction: a second firing sees the order is no longer
// AWAITING_PAYMENT (COO already verified it, or the 60-min job already abandoned it)
// and skips.
export async function handlePaymentReminderJob(job: Job): Promise<void> {
  const { orderId } = job.data as { orderId: string };
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order || order.status !== 'awaiting_payment') {
    logger.info(
      { orderId, status: order?.status },
      'Payment-reminder fired but order is no longer AWAITING_PAYMENT — skipping',
    );
    return;
  }

  // Unlike the other three handlers, sending a reminder has no status transition of
  // its own to naturally gate a duplicate firing on — this marker is that guard.
  if (order.notes?.includes(PAYMENT_REMINDER_SENT_MARKER)) {
    logger.info({ orderId }, 'Payment-reminder already sent for this order — skipping duplicate');
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: order.userId } });
  await sendManualMessage(user.phoneNumber, PAYMENT_REMINDER_MESSAGE);

  await prisma.order.update({
    where: { id: orderId },
    data: { notes: order.notes ? `${order.notes}\n${PAYMENT_REMINDER_SENT_MARKER}` : PAYMENT_REMINDER_SENT_MARKER },
  });
}

// Idempotent by construction: a second firing sees the order is no longer
// AWAITING_PAYMENT (already abandoned by the first firing, or COO already verified it)
// and skips.
export async function handlePaymentAbandonJob(job: Job): Promise<void> {
  const { orderId } = job.data as { orderId: string };
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });

  if (!order || order.status !== 'awaiting_payment') {
    logger.info(
      { orderId, status: order?.status },
      'Payment-abandon fired but order is no longer AWAITING_PAYMENT — skipping',
    );
    return;
  }

  await transitionOrderStatus(orderId, 'abandoned', 'system', 'Payment window (60 min) expired with no confirmation');
  await notify('PAYMENT_WINDOW_ABANDONED', orderId);

  // The customer's session is otherwise left dangling at AWAITING_PAYMENT, referencing
  // a now-dead order, forever holding future messages (awaitingPaymentHandler never
  // auto-transitions). Only reset it if it's still exactly the session this order left
  // behind — a customer who has since started a fresh conversation must not have their
  // new, unrelated progress wiped out.
  const session = await prisma.session.findUnique({ where: { phoneNumber: order.user.phoneNumber } });
  const sessionOrderId = (session?.context as { orderId?: string } | null)?.orderId;
  if (session?.state === 'AWAITING_PAYMENT' && sessionOrderId === orderId) {
    await saveSession(order.user.phoneNumber, 'IDLE', {});
  }
}
