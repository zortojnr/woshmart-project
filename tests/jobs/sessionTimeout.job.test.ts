// Idempotency proof for the three sessionTimeout.job.ts handlers (docs/BUILD_SCRIPT.md
// Phase 6 item 5): calling each handler twice with the same job.data must produce
// exactly one customer-facing side effect, not two — a retried/duplicated job
// delivery (BullMQ redelivery, a worker crash mid-processing, etc.) must be safe.
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { PAYMENT_REMINDER_MESSAGE, QUOTE_TIMEOUT_MESSAGE } from '../../src/conversation/messages';
import type * as SessionTimeoutJob from '../../src/jobs/sessionTimeout.job';

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

let handlePaymentAbandonJob: typeof SessionTimeoutJob.handlePaymentAbandonJob;
let handlePaymentReminderJob: typeof SessionTimeoutJob.handlePaymentReminderJob;
let handleQuoteTimeoutJob: typeof SessionTimeoutJob.handleQuoteTimeoutJob;

beforeAll(async () => {
  ({ handlePaymentAbandonJob, handlePaymentReminderJob, handleQuoteTimeoutJob } = await import(
    '../../src/jobs/sessionTimeout.job'
  ));
});

function fakeJob(data: Record<string, unknown>): Job {
  return { data } as unknown as Job;
}

const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
const createdPhoneNumbers: string[] = [];

afterAll(async () => {
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { phoneNumber: { in: createdPhoneNumbers } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  sendMessageMock.mockClear();
});

describe('handleQuoteTimeoutJob — idempotency', () => {
  it('fires once for a session still at QUOTE_PENDING, and is a no-op on a second call', async () => {
    const phoneNumber = `+234720${Date.now().toString().slice(-7)}`;
    createdPhoneNumbers.push(phoneNumber);
    await prisma.session.create({ data: { phoneNumber, state: 'QUOTE_PENDING', context: { bundleId: 'starter' } } });

    await handleQuoteTimeoutJob(fakeJob({ phoneNumber }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({ to: phoneNumber, body: QUOTE_TIMEOUT_MESSAGE });

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('IDLE');

    // Second firing: session is now IDLE, not QUOTE_PENDING — must skip entirely.
    await handleQuoteTimeoutJob(fakeJob({ phoneNumber }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing if the session already moved on before the job fired', async () => {
    const phoneNumber = `+234721${Date.now().toString().slice(-7)}`;
    createdPhoneNumbers.push(phoneNumber);
    await prisma.session.create({ data: { phoneNumber, state: 'AWAITING_PAYMENT', context: {} } });

    await handleQuoteTimeoutJob(fakeJob({ phoneNumber }));
    expect(sendMessageMock).not.toHaveBeenCalled();

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('AWAITING_PAYMENT');
  });
});

async function makeAwaitingPaymentOrder() {
  const phoneNumber = `+234722${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-JOB-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      address: '1 Test Street',
      zone: 'Maitumbi',
      serviceType: 'starter',
      serviceTotalKobo: 200_000n,
      grandTotalKobo: 300_000n,
      paymentMethod: 'transfer',
      status: 'awaiting_payment',
    },
  });
  createdOrderIds.push(order.id);
  createdUserIds.push(user.id);
  return { order, user, phoneNumber };
}

describe('handlePaymentReminderJob — idempotency', () => {
  it('sends the reminder once for an order still AWAITING_PAYMENT, and skips on a second call', async () => {
    const { order, phoneNumber } = await makeAwaitingPaymentOrder();

    await handlePaymentReminderJob(fakeJob({ orderId: order.id }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({ to: phoneNumber, body: PAYMENT_REMINDER_MESSAGE });

    // Second firing: order is still AWAITING_PAYMENT (no status transition happens for
    // a reminder), so the marker in `notes` is what must prevent a duplicate send.
    await handlePaymentReminderJob(fakeJob({ orderId: order.id }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.notes).toContain('[payment-reminder-sent]');
  });

  it('does nothing if the order is no longer AWAITING_PAYMENT', async () => {
    const { order } = await makeAwaitingPaymentOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } });

    await handlePaymentReminderJob(fakeJob({ orderId: order.id }));
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe('handlePaymentAbandonJob — idempotency', () => {
  it('abandons the order and notifies once, and skips on a second call', async () => {
    const { order, phoneNumber } = await makeAwaitingPaymentOrder();

    await handlePaymentAbandonJob(fakeJob({ orderId: order.id }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({ to: phoneNumber, body: expect.stringContaining("didn't receive your payment") });

    const abandoned = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(abandoned.status).toBe('abandoned');

    // Second firing: order is now `abandoned`, not `awaiting_payment` — must skip,
    // no duplicate customer message, no duplicate (and illegal) re-transition attempt.
    await handlePaymentAbandonJob(fakeJob({ orderId: order.id }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1);
  });

  it('resets the session back to IDLE only if it still matches this exact order', async () => {
    const { order, phoneNumber } = await makeAwaitingPaymentOrder();
    createdPhoneNumbers.push(phoneNumber);
    await prisma.session.create({
      data: { phoneNumber, state: 'AWAITING_PAYMENT', context: { orderId: order.id } },
    });

    await handlePaymentAbandonJob(fakeJob({ orderId: order.id }));

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('IDLE');
  });

  it('does not touch a session that has already moved on to a different order/state', async () => {
    const { order, phoneNumber } = await makeAwaitingPaymentOrder();
    createdPhoneNumbers.push(phoneNumber);
    await prisma.session.create({
      data: { phoneNumber, state: 'SERVICE_SELECTION', context: { area: 'Maitumbi' } },
    });

    await handlePaymentAbandonJob(fakeJob({ orderId: order.id }));

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('SERVICE_SELECTION');
  });
});
