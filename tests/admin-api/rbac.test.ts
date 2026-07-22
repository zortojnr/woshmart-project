// RBAC: explicitly assert a viewer-role token is rejected on every write route, not
// just hidden in a Retool UI (docs/BUILD_SCRIPT.md Phase 5 item 6 / CLAUDE.md's Phase 5
// human-scrutiny note). Each case also asserts the role that *should* be allowed
// actually succeeds, so this isn't just testing that everything 403s.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { cleanupAdmin, createTestAdmin } from './testHelpers';

// Assign and manual-send routes fan out through the Notification Service, which calls
// this — mocked here so RBAC tests never hit the real Twilio API.
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

async function makeTestOrder(status: 'paid' | 'assigned' = 'paid') {
  const phoneNumber = `+234701${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  const woshman = await prisma.woshman.create({ data: { name: 'RBAC Test Woshman', phoneNumber: `${phoneNumber}1` } });
  const partner = await prisma.partner.create({ data: { name: 'RBAC Test Partner', phoneNumber: `${phoneNumber}2` } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `WM-RBAC-${randomUUID().slice(0, 8)}`,
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
    await prisma.woshman.delete({ where: { id: woshman.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });
  return { order, user, woshman, partner };
}

async function makeTestUser() {
  const phoneNumber = `+234702${Date.now().toString().slice(-7)}`;
  const user = await prisma.user.create({ data: { phoneNumber } });
  cleanupCallbacks.push(async () => {
    await prisma.user.delete({ where: { id: user.id } });
  });
  return user;
}

async function makeTestWoshman() {
  const phoneNumber = `+234703${Date.now().toString().slice(-7)}`;
  const woshman = await prisma.woshman.create({ data: { name: 'RBAC Woshman', phoneNumber } });
  cleanupCallbacks.push(async () => {
    await prisma.woshman.delete({ where: { id: woshman.id } });
  });
  return woshman;
}

async function makeTestPartner() {
  const phoneNumber = `+234709${Date.now().toString().slice(-7)}`;
  const partner = await prisma.partner.create({ data: { name: 'RBAC Partner', phoneNumber } });
  cleanupCallbacks.push(async () => {
    await prisma.partner.delete({ where: { id: partner.id } });
  });
  return partner;
}

describe('Admin API RBAC — write routes', () => {
  it('PATCH /admin/orders/:id/status — viewer rejected (403), ops allowed', async () => {
    const { order } = await makeTestOrder('paid');
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ status: 'assigned' });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch(`/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ status: 'cancelled' });
    expect(opsRes.status).toBe(200);
  });

  it('PATCH /admin/orders/:id/assign — viewer rejected (403), ops allowed', async () => {
    const { order, woshman, partner } = await makeTestOrder('paid');
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch(`/admin/orders/${order.id}/assign`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ woshmanId: woshman.id, partnerId: partner.id });
    expect(opsRes.status).toBe(200);
  });

  it('PATCH /admin/users/:id/flag — viewer rejected (403), ops allowed', async () => {
    const user = await makeTestUser();
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .patch(`/admin/users/${user.id}/flag`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ accountStatus: 'flagged' });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch(`/admin/users/${user.id}/flag`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ accountStatus: 'flagged' });
    expect(opsRes.status).toBe(200);
  });

  it('PATCH /admin/woshmen/:id — viewer rejected (403), ops allowed', async () => {
    const woshman = await makeTestWoshman();
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .patch(`/admin/woshmen/${woshman.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ availability: 'off_duty' });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch(`/admin/woshmen/${woshman.id}`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ availability: 'off_duty' });
    expect(opsRes.status).toBe(200);
  });

  it('PATCH /admin/partners/:id — viewer rejected (403), ops allowed', async () => {
    const partner = await makeTestPartner();
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .patch(`/admin/partners/${partner.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ status: 'warning' });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch(`/admin/partners/${partner.id}`)
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ status: 'warning' });
    expect(opsRes.status).toBe(200);
  });

  it('PATCH /admin/pricing — viewer AND ops both rejected (403), only super_admin allowed', async () => {
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    const superAdmin = await createTestAdmin('super_admin');
    createdAdminIds.push(viewer.admin.id, ops.admin.id, superAdmin.admin.id);

    const viewerRes = await request(app)
      .patch('/admin/pricing')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ key: 'test.rbac.key', value: { foo: 'bar' } });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .patch('/admin/pricing')
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ key: 'test.rbac.key', value: { foo: 'bar' } });
    expect(opsRes.status).toBe(403);

    const superAdminRes = await request(app)
      .patch('/admin/pricing')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ key: 'test.rbac.key', value: { foo: 'bar' } });
    expect(superAdminRes.status).toBe(200);

    cleanupCallbacks.push(async () => {
      await prisma.pricingConfig.deleteMany({ where: { key: 'test.rbac.key' } });
    });
  });

  it('POST /admin/messages/send — viewer rejected (403), ops allowed', async () => {
    const user = await makeTestUser();
    const viewer = await createTestAdmin('viewer');
    const ops = await createTestAdmin('ops');
    createdAdminIds.push(viewer.admin.id, ops.admin.id);

    const viewerRes = await request(app)
      .post('/admin/messages/send')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ userId: user.id, body: 'test message' });
    expect(viewerRes.status).toBe(403);

    const opsRes = await request(app)
      .post('/admin/messages/send')
      .set('Authorization', `Bearer ${ops.token}`)
      .send({ userId: user.id, body: 'test message' });
    expect(opsRes.status).toBe(200);
  });
});
