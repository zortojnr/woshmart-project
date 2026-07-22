// Proves the BigInt -> JSON fix (src/lib/bigintJson.ts) actually works end-to-end
// through a real HTTP response, not just that the shim function works in isolation.
// Before that fix, any route returning an order record 500'd outright on
// JSON.stringify (money columns are BIGINT in Postgres, `bigint` in Prisma/JS) — a
// bare `res.status).toBe(200)` on an order response is *implicit* proof the shim
// works, but doesn't pin down that the values themselves are correct numbers rather
// than, say, silently dropped or stringified.
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

describe('GET /admin/orders/:id — BigInt money fields serialize as real numbers', () => {
  it('returns every Kobo field as a JSON number with the correct value, not a string or missing field', async () => {
    const phoneNumber = `+234710${Date.now().toString().slice(-7)}`;
    const user = await prisma.user.create({ data: { phoneNumber } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `WM-SERIAL-${randomUUID().slice(0, 8)}`,
        userId: user.id,
        address: '1 Test Street',
        zone: 'Maitumbi',
        serviceType: 'family',
        serviceTotalKobo: 550_000n,
        smallBasketFeeKobo: 50_000n,
        logisticsFeeKobo: 100_000n,
        grandTotalKobo: 700_000n,
        amountPaidKobo: 700_000n,
        paymentMethod: 'transfer',
        status: 'paid',
      },
    });
    cleanupCallbacks.push(async () => {
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    const { admin, token } = await createTestAdmin('viewer');
    createdAdminIds.push(admin.id);

    const res = await request(app).get(`/admin/orders/${order.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const body = res.body.order;
    for (const field of ['serviceTotalKobo', 'smallBasketFeeKobo', 'logisticsFeeKobo', 'grandTotalKobo', 'amountPaidKobo']) {
      expect(typeof body[field]).toBe('number');
    }
    expect(body.serviceTotalKobo).toBe(550_000);
    expect(body.smallBasketFeeKobo).toBe(50_000);
    expect(body.logisticsFeeKobo).toBe(100_000);
    expect(body.grandTotalKobo).toBe(700_000);
    expect(body.amountPaidKobo).toBe(700_000);
  });
});
