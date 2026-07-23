// 24hr auto-close job (docs/BUILD_SCRIPT.md Phase 6 item 3): DELIVERED -> CLOSED if
// still DELIVERED (no DISPUTED flag) 24 hours after delivery. Scheduling/cancellation
// lives in order.statemachine.ts (the single choke point for every order status write,
// CLAUDE.md rule 4) rather than here, to avoid a circular import — this file needs
// transitionOrderStatus for the firing/handler side below, so it can't be imported by
// statemachine.ts in the other direction.
import type { Job } from 'bullmq';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { transitionOrderStatus } from '../domain/orders/order.statemachine';

// Idempotent by construction: a second firing (retry, duplicate delivery) sees the
// order is no longer DELIVERED (already closed by the first firing, or disputed in the
// meantime) and skips — no duplicate transition, no duplicate history row.
export async function handleAutoCloseJob(job: Job): Promise<void> {
  const { orderId } = job.data as { orderId: string };
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) {
    logger.warn({ orderId }, 'Auto-close job fired for an order that no longer exists — skipping');
    return;
  }
  if (order.status !== 'delivered') {
    logger.info(
      { orderId, status: order.status },
      'Auto-close job fired but order is no longer DELIVERED — skipping (already disputed/closed)',
    );
    return;
  }

  await transitionOrderStatus(orderId, 'closed', 'system', 'Auto-closed 24h after delivery with no dispute');
}
