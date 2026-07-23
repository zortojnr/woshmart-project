// Idempotency review pass, admin write endpoints (docs/BUILD_SCRIPT.md Phase 6 item 5):
// PATCH /admin/orders/:id/assign must not re-send the dispatch confirmation / dispatch
// brief / job brief on a double-click or retry. This was a genuine gap found during the
// Phase 6 review, not caught when the route was originally built in Phase 5 — notify()
// fired unconditionally on every successful call, regardless of whether the Woshman/
// partner had actually changed.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { cleanupAdmin, createTestAdmin } from './testHelpers';

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

const app = createApp();
const createdAdminIds: string[] = [];
const cleanupCallbacks: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cb of cleanupCallbacks) await cb();
  for (const id of createdAdminIds) await cleanupAdmin(id);
  await prisma.$disconnect();
});

async function makePaidOrder() {
  const phoneNumber = `+234726${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  const woshman = await prisma.woshman.create({ data: { name: 'Idempotency Test Woshman', phoneNumber: `${phoneNumber}1` } });
  const partner = await prisma.partner.create({ data: { name: 'Idempotency Test Partner', phoneNumber: `${phoneNumber}2` } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-ASSIGNIDEM-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      address: '1 Test Street',
      zone: 'Maitumbi',
      serviceType: 'starter',
      serviceTotalKobo: 200_000n,
      grandTotalKobo: 300_000n,
      paymentMethod: 'transfer',
      status: 'paid',
    },
  });
  cleanupCallbacks.push(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.woshman.delete({ where: { id: woshman.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });
  return { order, woshman, partner };
}

describe('PATCH /admin/orders/:id/assign — idempotency', () => {
  it('sends the ASSIGNED notifications once on the first call, and skips them on an identical retry', async () => {
    const { order, woshman, partner } = await makePaidOrder();
    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const firstRes = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });
    expect(firstRes.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(3); // customer + Woshman + partner

    sendMessageMock.mockClear();

    // Retry: identical body, same order (now already at `assigned` with these exact
    // woshmanId/partnerId) — must be a 200 (assignOrder tolerates the repeat) with zero
    // new sends, not three more.
    const retryRes = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });
    expect(retryRes.status).toBe(200);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('still notifies on a genuine reassignment to a different Woshman/partner', async () => {
    const { order, woshman, partner } = await makePaidOrder();
    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });
    sendMessageMock.mockClear();

    const phoneNumber = `+234727${Date.now().toString().slice(-7)}`;
    const newWoshman = await prisma.woshman.create({ data: { name: 'Replacement Woshman', phoneNumber } });
    cleanupCallbacks.push(async () => {
      await prisma.woshman.delete({ where: { id: newWoshman.id } });
    });

    const reassignRes = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ woshmanId: newWoshman.id, partnerId: partner.id });
    expect(reassignRes.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(3); // a genuine change — must notify again
  });
});
