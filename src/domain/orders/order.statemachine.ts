// Legal-transition enforcement (docs/TRD.md §9). This is the ONLY code path allowed to
// write orders.status — the Admin API, the keyword parser, and every job all call this,
// never `prisma.order.update()` directly (CLAUDE.md rule 4).
import type { Order } from '@prisma/client';
import { prisma } from '../../db/client';
import { logger } from '../../lib/logger';
import {
  AUTO_CLOSE_DELAY_MS,
  AUTO_CLOSE_JOB_NAME,
  autoCloseJobId,
  PAYMENT_ABANDON_DELAY_MS,
  PAYMENT_ABANDON_JOB_NAME,
  paymentAbandonJobId,
  PAYMENT_REMINDER_DELAY_MS,
  PAYMENT_REMINDER_JOB_NAME,
  paymentReminderJobId,
} from '../../jobs/jobIds';
import { cancelJob, scheduleJob } from '../../jobs/queue';
import type { ChangedBy, OrderStatus } from './order.types';

const LEGAL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  initiated: ['awaiting_confirmation', 'abandoned', 'cancelled'],
  awaiting_confirmation: ['awaiting_payment', 'abandoned', 'cancelled'],
  awaiting_payment: ['paid', 'abandoned', 'cancelled'],
  paid: ['assigned', 'cancelled', 'disputed'],
  assigned: ['pickup_scheduled', 'cancelled'],
  pickup_scheduled: ['picked_up', 'cancelled'],
  picked_up: ['at_laundry', 'disputed'],
  at_laundry: ['ready_for_delivery', 'disputed'],
  ready_for_delivery: ['out_for_delivery', 'disputed'],
  out_for_delivery: ['delivered', 'disputed'],
  delivered: ['closed', 'disputed'],
  closed: [],
  cancelled: [],
  abandoned: [],
  disputed: ['closed', 'cancelled'],
};

export class IllegalOrderTransitionError extends Error {
  constructor(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus) {
    super(`Illegal order status transition: order ${orderId} cannot go from "${fromStatus}" to "${toStatus}"`);
    this.name = 'IllegalOrderTransitionError';
  }
}

// Idempotent: calling this again with the status the order is already at (e.g. a
// retried webhook/keyword/job) is a no-op success, not an error — CLAUDE.md rule 6.
// Any other transition not in LEGAL_TRANSITIONS is rejected and logged, never silently
// applied (CLAUDE.md rule 4 / TRD.md §9).
export async function transitionOrderStatus(
  orderId: string,
  toStatus: OrderStatus,
  changedBy: ChangedBy,
  note?: string,
): Promise<Order> {
  let previousStatus: OrderStatus | undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const fromStatus = order.status as OrderStatus;
    previousStatus = fromStatus;

    if (fromStatus === toStatus) {
      logger.info({ orderId, status: toStatus }, 'Order status transition is a no-op — already at target status');
      return order;
    }

    const allowedTargets = LEGAL_TRANSITIONS[fromStatus] ?? [];
    if (!allowedTargets.includes(toStatus)) {
      logger.error(
        { orderId, fromStatus, toStatus, changedBy },
        'Rejected illegal order status transition',
      );
      throw new IllegalOrderTransitionError(orderId, fromStatus, toStatus);
    }

    const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { status: toStatus } });
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus, toStatus, changedBy, note: note ?? null },
    });

    return updatedOrder;
  });

  // Job scheduling happens after the transaction commits, and only on a REAL
  // transition (not the same-status no-op above, where previousStatus === toStatus) —
  // this function's own idempotency (a repeat call with the same toStatus is a safe
  // no-op) combined with scheduleJob/cancelJob's own idempotency (deterministic jobId)
  // means a retried caller never produces duplicate jobs either way (CLAUDE.md rule 6).
  if (previousStatus !== undefined && previousStatus !== toStatus) {
    await handlePostTransitionJobs(orderId, previousStatus, toStatus);
  }

  return updated;
}

// docs/PRD.md §8 payment window + docs/BUILD_SCRIPT.md Phase 6 auto-close. Schedules
// and cancellations live here, not in the job files themselves, so every caller of
// transitionOrderStatus (order creation, the keyword protocol, the Admin API) gets
// this for free without each needing its own copy of this logic.
async function handlePostTransitionJobs(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus): Promise<void> {
  if (toStatus === 'awaiting_payment') {
    await Promise.all([
      scheduleJob(PAYMENT_REMINDER_JOB_NAME, paymentReminderJobId(orderId), { orderId }, PAYMENT_REMINDER_DELAY_MS),
      scheduleJob(PAYMENT_ABANDON_JOB_NAME, paymentAbandonJobId(orderId), { orderId }, PAYMENT_ABANDON_DELAY_MS),
    ]);
  } else if (fromStatus === 'awaiting_payment') {
    await Promise.all([cancelJob(paymentReminderJobId(orderId)), cancelJob(paymentAbandonJobId(orderId))]);
  }

  if (toStatus === 'delivered') {
    await scheduleJob(AUTO_CLOSE_JOB_NAME, autoCloseJobId(orderId), { orderId }, AUTO_CLOSE_DELAY_MS);
  } else if (fromStatus === 'delivered') {
    await cancelJob(autoCloseJobId(orderId));
  }
}
