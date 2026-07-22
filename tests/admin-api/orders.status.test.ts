// PATCH /admin/orders/:id/status must reject an illegal transition the same way the
// conversation engine and keyword parser do — through order.statemachine.ts, never a
// fourth path that writes orders.status directly (docs/BUILD_SCRIPT.md Phase 5 item 6).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { cleanupAdmin, createTestAdmin } from './testHelpers';

const app = createApp();
const createdAdminIds: string[] = [];
const cleanupCallbacks: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cb of cleanupCallbacks) await cb();
  for (const id of createdAdminIds) await cleanupAdmin(id);
  await prisma.$disconnect();
});

async function makeTestOrder(status: string) {
  const phoneNumber = `+234705${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-STATUS-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      address: '1 Test Street',
      zone: 'Maitumbi',
      serviceType: 'starter',
      serviceTotalKobo: 200_000n,
      grandTotalKobo: 300_000n,
      paymentMethod: 'transfer',
      status,
    },
  });
  cleanupCallbacks.push(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
  return order;
}

describe('PATCH /admin/orders/:id/status — illegal transitions', () => {
  it('rejects picked_up before paid/assigned with 400, same as the statemachine', async () => {
    const order = await makeTestOrder('initiated');
    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'picked_up' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/illegal order status transition/i);

    const stillInitiated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillInitiated.status).toBe('initiated');

    const actions = await prisma.adminAction.findMany({ where: { adminId: admin.id, entityId: order.id } });
    expect(actions).toHaveLength(0);
  });

  it('allows the legal paid -> assigned equivalent transition via a direct status override', async () => {
    const order = await makeTestOrder('paid');
    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled', note: 'customer requested cancellation' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'paid', toStatus: 'cancelled', changedBy: `admin:${admin.id}` });
  });

  it('returns 404 for an order that does not exist', async () => {
    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/orders/${randomUUID()}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'paid' });

    expect(res.status).toBe(404);
  });
});
