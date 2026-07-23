// Idempotency proof for autoClose.job.ts (docs/BUILD_SCRIPT.md Phase 6 item 5): firing
// the job twice must not attempt a duplicate (and illegal, since closed has no legal
// transitions) re-transition.
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client';
import { handleAutoCloseJob } from '../../src/jobs/autoClose.job';

function fakeJob(data: Record<string, unknown>): Job {
  return { data } as unknown as Job;
}

const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeDeliveredOrder() {
  const phoneNumber = `+234723${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-CLOSE-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      address: '1 Test Street',
      zone: 'Maitumbi',
      serviceType: 'starter',
      serviceTotalKobo: 200_000n,
      grandTotalKobo: 300_000n,
      paymentMethod: 'transfer',
      status: 'delivered',
    },
  });
  createdOrderIds.push(order.id);
  createdUserIds.push(user.id);
  return order;
}

describe('handleAutoCloseJob — idempotency', () => {
  it('closes an order still DELIVERED, and is a no-op on a second call', async () => {
    const order = await makeDeliveredOrder();

    await handleAutoCloseJob(fakeJob({ orderId: order.id }));
    const closed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(closed.status).toBe('closed');

    // Second firing: order is now `closed` — must skip, not attempt an illegal
    // closed -> closed / re-transition, and not write a second history row.
    await handleAutoCloseJob(fakeJob({ orderId: order.id }));
    const stillClosed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillClosed.status).toBe('closed');

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'delivered', toStatus: 'closed', changedBy: 'system' });
  });

  it('does nothing if the order was disputed before the job fired', async () => {
    const order = await makeDeliveredOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'disputed' } });

    await handleAutoCloseJob(fakeJob({ orderId: order.id }));

    const stillDisputed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillDisputed.status).toBe('disputed');
  });
});
