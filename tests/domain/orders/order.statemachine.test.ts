import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db/client';
import {
  IllegalOrderTransitionError,
  transitionOrderStatus,
} from '../../../src/domain/orders/order.statemachine';
import type { OrderStatus } from '../../../src/domain/orders/order.types';

const testPhoneNumber = `+234700${Date.now().toString().slice(-7)}`;
let userId: string;
const createdOrderIds: string[] = [];

async function createTestOrder(status: OrderStatus = 'initiated') {
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-TEST-${randomUUID().slice(0, 8)}`,
      userId,
      address: '1 Test Street',
      zone: 'Maitumbi',
      serviceType: 'starter',
      serviceTotalKobo: 200_000n,
      grandTotalKobo: 300_000n,
      paymentMethod: 'transfer',
      status,
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

describe('order.statemachine — transitionOrderStatus', () => {
  beforeEach(async () => {
    const user = await prisma.user.upsert({
      where: { phoneNumber: testPhoneNumber },
      update: {},
      create: { phoneNumber: testPhoneNumber },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.user.deleteMany({ where: { phoneNumber: testPhoneNumber } });
    await prisma.$disconnect();
  });

  it('walks the full legal happy path from initiated to closed, one hop at a time', async () => {
    const order = await createTestOrder('initiated');
    const path: OrderStatus[] = [
      'awaiting_confirmation',
      'awaiting_payment',
      'paid',
      'assigned',
      'pickup_scheduled',
      'picked_up',
      'at_laundry',
      'ready_for_delivery',
      'out_for_delivery',
      'delivered',
      'closed',
    ];

    let current = order;
    for (const next of path) {
      current = await transitionOrderStatus(current.id, next, 'system');
      expect(current.status).toBe(next);
    }

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history).toHaveLength(path.length);
    expect(history[0]).toMatchObject({ fromStatus: 'initiated', toStatus: 'awaiting_confirmation' });
    expect(history[history.length - 1]).toMatchObject({ fromStatus: 'delivered', toStatus: 'closed' });
  });

  it('rejects a transition that skips steps (initiated -> paid) and does not write a history row', async () => {
    const order = await createTestOrder('initiated');

    await expect(transitionOrderStatus(order.id, 'paid', 'system')).rejects.toThrow(
      IllegalOrderTransitionError,
    );

    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.status).toBe('initiated');
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(0);
  });

  it('rejects picked_up -> delivered (skips at_laundry, ready_for_delivery, out_for_delivery)', async () => {
    const order = await createTestOrder('picked_up');
    await expect(transitionOrderStatus(order.id, 'delivered', 'system')).rejects.toThrow(
      IllegalOrderTransitionError,
    );
  });

  it('rejects any transition attempted from a terminal state (closed)', async () => {
    const order = await createTestOrder('closed');
    await expect(transitionOrderStatus(order.id, 'assigned', 'system')).rejects.toThrow(
      IllegalOrderTransitionError,
    );
  });

  it('disputed can resolve to either closed or cancelled, but nowhere else', async () => {
    const toClose = await createTestOrder('disputed');
    const closed = await transitionOrderStatus(toClose.id, 'closed', 'system');
    expect(closed.status).toBe('closed');

    const toCancel = await createTestOrder('disputed');
    const cancelled = await transitionOrderStatus(toCancel.id, 'cancelled', 'system');
    expect(cancelled.status).toBe('cancelled');

    const toReject = await createTestOrder('disputed');
    await expect(transitionOrderStatus(toReject.id, 'picked_up', 'system')).rejects.toThrow(
      IllegalOrderTransitionError,
    );
  });

  it('re-requesting the status the order is already at is an idempotent no-op, not an error', async () => {
    const order = await createTestOrder('awaiting_payment');

    const first = await transitionOrderStatus(order.id, 'paid', 'system');
    expect(first.status).toBe('paid');

    const second = await transitionOrderStatus(order.id, 'paid', 'system');
    expect(second.status).toBe('paid');

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1); // only the real transition logged, not the repeat
  });

  it('records changedBy and an optional note on the history row', async () => {
    const order = await createTestOrder('paid');
    await transitionOrderStatus(order.id, 'assigned', 'admin:test-admin-id', 'Assigned via test');

    const history = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id } });
    expect(history).toMatchObject({
      fromStatus: 'paid',
      toStatus: 'assigned',
      changedBy: 'admin:test-admin-id',
      note: 'Assigned via test',
    });
  });
});
