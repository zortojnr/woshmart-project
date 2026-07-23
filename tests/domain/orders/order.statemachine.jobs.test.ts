// Proves order.statemachine.ts actually schedules/cancels the right jobs on the right
// transitions (docs/BUILD_SCRIPT.md Phase 6) — separate from
// order.statemachine.test.ts's existing legal-transition coverage, which predates
// Phase 6 and doesn't touch jobs at all.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../src/db/client';
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
} from '../../../src/jobs/jobIds';
import type * as OrderStatemachine from '../../../src/domain/orders/order.statemachine';

const scheduleJobMock = vi.fn().mockResolvedValue(undefined);
const cancelJobMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/jobs/queue', () => ({
  scheduleJob: (...args: unknown[]) => scheduleJobMock(...args),
  cancelJob: (...args: unknown[]) => cancelJobMock(...args),
}));

let transitionOrderStatus: typeof OrderStatemachine.transitionOrderStatus;

beforeAll(async () => {
  ({ transitionOrderStatus } = await import('../../../src/domain/orders/order.statemachine'));
});

const testPhoneNumber = `+234724${Date.now().toString().slice(-7)}`;
let userId: string;
const createdOrderIds: string[] = [];

async function createTestOrder(status: string) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-JOBSCHED-${randomUUID().slice(0, 8)}`,
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

describe('order.statemachine — job scheduling side effects', () => {
  beforeEach(async () => {
    const user = await prisma.user.upsert({
      where: { phoneNumber: testPhoneNumber },
      update: {},
      create: { phoneNumber: testPhoneNumber },
    });
    userId = user.id;
    scheduleJobMock.mockClear();
    cancelJobMock.mockClear();
  });

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.user.deleteMany({ where: { phoneNumber: testPhoneNumber } });
    await prisma.$disconnect();
  });

  it('entering awaiting_payment schedules both the reminder and abandon jobs', async () => {
    const order = await createTestOrder('awaiting_confirmation');
    await transitionOrderStatus(order.id, 'awaiting_payment', 'system');

    expect(scheduleJobMock).toHaveBeenCalledWith(
      PAYMENT_REMINDER_JOB_NAME,
      paymentReminderJobId(order.id),
      { orderId: order.id },
      PAYMENT_REMINDER_DELAY_MS,
    );
    expect(scheduleJobMock).toHaveBeenCalledWith(
      PAYMENT_ABANDON_JOB_NAME,
      paymentAbandonJobId(order.id),
      { orderId: order.id },
      PAYMENT_ABANDON_DELAY_MS,
    );
    expect(cancelJobMock).not.toHaveBeenCalled();
  });

  it('leaving awaiting_payment (e.g. to paid) cancels both payment jobs', async () => {
    const order = await createTestOrder('awaiting_payment');
    await transitionOrderStatus(order.id, 'paid', 'system');

    expect(cancelJobMock).toHaveBeenCalledWith(paymentReminderJobId(order.id));
    expect(cancelJobMock).toHaveBeenCalledWith(paymentAbandonJobId(order.id));
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });

  it('entering delivered schedules the auto-close job', async () => {
    const order = await createTestOrder('out_for_delivery');
    await transitionOrderStatus(order.id, 'delivered', 'system');

    expect(scheduleJobMock).toHaveBeenCalledWith(
      AUTO_CLOSE_JOB_NAME,
      autoCloseJobId(order.id),
      { orderId: order.id },
      AUTO_CLOSE_DELAY_MS,
    );
  });

  it('leaving delivered (e.g. to disputed) cancels the auto-close job', async () => {
    const order = await createTestOrder('delivered');
    await transitionOrderStatus(order.id, 'disputed', 'system');

    expect(cancelJobMock).toHaveBeenCalledWith(autoCloseJobId(order.id));
  });

  it('a same-status no-op transition schedules and cancels nothing', async () => {
    const order = await createTestOrder('awaiting_payment');
    await transitionOrderStatus(order.id, 'awaiting_payment', 'system');

    expect(scheduleJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
  });

  it('an illegal transition schedules and cancels nothing', async () => {
    const order = await createTestOrder('initiated');
    await expect(transitionOrderStatus(order.id, 'delivered', 'system')).rejects.toThrow();

    expect(scheduleJobMock).not.toHaveBeenCalled();
    expect(cancelJobMock).not.toHaveBeenCalled();
  });
});
