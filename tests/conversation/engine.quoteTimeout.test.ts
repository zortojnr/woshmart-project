// Proves the conversation engine actually schedules/cancels the 30-min quote-timeout
// job at the right moments (docs/BUILD_SCRIPT.md Phase 6 item 2) — the one timeout NOT
// wired through order.statemachine.ts (no order exists yet at QUOTE_PENDING), so it's
// not covered by order.statemachine.jobs.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import type * as Engine from '../../src/conversation/engine';

const scheduleQuoteTimeoutJobMock = vi.fn().mockResolvedValue(undefined);
const cancelQuoteTimeoutJobMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/jobs/sessionTimeout.job', () => ({
  scheduleQuoteTimeoutJob: (...args: unknown[]) => scheduleQuoteTimeoutJobMock(...args),
  cancelQuoteTimeoutJob: (...args: unknown[]) => cancelQuoteTimeoutJobMock(...args),
}));

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

let processInboundMessage: typeof Engine.processInboundMessage;

beforeAll(async () => {
  ({ processInboundMessage } = await import('../../src/conversation/engine'));
});

const phoneNumber = `+234725${Date.now().toString().slice(-7)}`;

afterAll(async () => {
  const user = await prisma.user.findUnique({ where: { phoneNumber } });
  if (user) {
    const orders = await prisma.order.findMany({ where: { userId: user.id } });
    const orderIds = orders.map((o) => o.id);
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.session.deleteMany({ where: { phoneNumber } });
  await prisma.$disconnect();
});

beforeEach(() => {
  scheduleQuoteTimeoutJobMock.mockClear();
  cancelQuoteTimeoutJobMock.mockClear();
});

describe('conversation engine — quote-timeout job scheduling', () => {
  it('schedules the job on entering QUOTE_PENDING from PAYMENT_METHOD', async () => {
    await prisma.session.upsert({
      where: { phoneNumber },
      update: { state: 'PAYMENT_METHOD', context: { area: 'Maitumbi', bundleId: 'starter', address: '1 Test St', pickupWindowId: '1' } },
      create: { phoneNumber, state: 'PAYMENT_METHOD', context: { area: 'Maitumbi', bundleId: 'starter', address: '1 Test St', pickupWindowId: '1' } },
    });

    await processInboundMessage(phoneNumber, '1', false); // "1" = bank transfer -> QUOTE_PENDING

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('QUOTE_PENDING');
    expect(scheduleQuoteTimeoutJobMock).toHaveBeenCalledWith(phoneNumber);
    expect(cancelQuoteTimeoutJobMock).not.toHaveBeenCalled();
  });

  it('re-schedules (idempotently, per scheduleJob\'s own jobId dedup) on an unmatched reply that stays in QUOTE_PENDING', async () => {
    await processInboundMessage(phoneNumber, 'gibberish', false);

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('QUOTE_PENDING');
    expect(scheduleQuoteTimeoutJobMock).toHaveBeenCalledWith(phoneNumber);
    expect(cancelQuoteTimeoutJobMock).not.toHaveBeenCalled();
  });

  it('cancels the job on leaving QUOTE_PENDING via NO', async () => {
    await processInboundMessage(phoneNumber, 'NO', false);

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('IDLE');
    expect(cancelQuoteTimeoutJobMock).toHaveBeenCalledWith(phoneNumber);
    expect(scheduleQuoteTimeoutJobMock).not.toHaveBeenCalled();
  });

  it('cancels the job on leaving QUOTE_PENDING via YES (order created, moves to AWAITING_PAYMENT)', async () => {
    await prisma.session.update({
      where: { phoneNumber },
      data: { state: 'QUOTE_PENDING', context: { area: 'Maitumbi', bundleId: 'starter', address: '1 Test St', pickupWindowId: '1', paymentMethod: 'transfer' } },
    });

    await processInboundMessage(phoneNumber, 'YES', false);

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber } });
    expect(session.state).toBe('AWAITING_PAYMENT');
    expect(cancelQuoteTimeoutJobMock).toHaveBeenCalledWith(phoneNumber);
    expect(scheduleQuoteTimeoutJobMock).not.toHaveBeenCalled();
  });
});
