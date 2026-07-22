// Audit logging: confirm a write produces a correct admin_actions row (docs/BUILD_SCRIPT.md
// Phase 5 item 6). Applies uniformly per audit.middleware.ts — no write route is exempt.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { cleanupAdmin, createTestAdmin } from './testHelpers';

// order.assign fans out through the Notification Service, which calls this — mocked so
// this test never hits the real Twilio API.
vi.mock('../../src/messaging/send.service', () => ({
  sendMessage: vi.fn().mockResolvedValue({ status: 'sent' }),
}));

const app = createApp();
const createdAdminIds: string[] = [];
const cleanupCallbacks: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cb of cleanupCallbacks) await cb();
  for (const id of createdAdminIds) await cleanupAdmin(id);
  await prisma.$disconnect();
});

describe('Admin API audit logging', () => {
  it('PATCH /admin/users/:id/flag writes a correct admin_actions row', async () => {
    const phoneNumber = `+234708${Date.now().toString().slice(-7)}`;
    const user = await prisma.user.create({ data: { phoneNumber, accountStatus: 'active' } });
    cleanupCallbacks.push(async () => {
      await prisma.user.delete({ where: { id: user.id } });
    });

    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/users/${user.id}/flag`)
      .set('Authorization', `Bearer ${token}`)
      .send({ accountStatus: 'flagged', notes: 'audit test' });

    expect(res.status).toBe(200);

    const actions = await prisma.adminAction.findMany({ where: { adminId: admin.id, entityId: user.id } });
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.action).toBe('user.flag');
    expect(action.entityType).toBe('user');
    expect(action.beforeValue).toMatchObject({ accountStatus: 'active' });
    expect(action.afterValue).toMatchObject({ accountStatus: 'flagged', notes: 'audit test' });
  });

  it('a rejected write (RBAC 403) produces no admin_actions row', async () => {
    const phoneNumber = `+234707${Date.now().toString().slice(-7)}`;
    const woshman = await prisma.woshman.create({ data: { name: 'Audit Test Woshman', phoneNumber } });
    cleanupCallbacks.push(async () => {
      await prisma.woshman.delete({ where: { id: woshman.id } });
    });

    const { admin, token } = await createTestAdmin('viewer');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/woshmen/${woshman.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ availability: 'off_duty' });

    expect(res.status).toBe(403);

    const actions = await prisma.adminAction.findMany({ where: { adminId: admin.id } });
    expect(actions).toHaveLength(0);
  });

  it('order.assign writes a before/after admin_actions row capturing the assignment', async () => {
    const phoneNumber = `+234706${Date.now().toString().slice(-7)}`;
    const user = await prisma.user.create({ data: { phoneNumber } });
    const woshman = await prisma.woshman.create({ data: { name: 'Audit Assign Woshman', phoneNumber: `${phoneNumber}1` } });
    const partner = await prisma.partner.create({ data: { name: 'Audit Assign Partner', phoneNumber: `${phoneNumber}2` } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `WM-AUDIT-${randomUUID().slice(0, 8)}`,
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

    const { admin, token } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });

    expect(res.status).toBe(200);

    const actions = await prisma.adminAction.findMany({ where: { adminId: admin.id, entityId: order.id } });
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.action).toBe('order.assign');
    expect(action.beforeValue).toMatchObject({ status: 'paid', woshmanId: null, partnerId: null });
    expect(action.afterValue).toMatchObject({ status: 'assigned', woshmanId: woshman.id, partnerId: partner.id });
  });
});
