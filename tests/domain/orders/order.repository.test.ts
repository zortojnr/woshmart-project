import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../src/db/client';
import { createInitiatedOrder, type CreateInitiatedOrderInput } from '../../../src/domain/orders/order.repository';

const basePhoneNumber = `+234709${Date.now().toString().slice(-7)}`;
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];

function baseInput(userId: string): CreateInitiatedOrderInput {
  return {
    userId,
    address: '1 Test Street',
    zone: 'Maitumbi',
    serviceType: 'starter',
    itemsDescription: '10 items',
    serviceTotalKobo: 200_000,
    smallBasketFeeKobo: 0,
    logisticsFeeKobo: 100_000,
    grandTotalKobo: 300_000,
    paymentMethod: 'transfer',
    pickupDate: new Date(),
    pickupWindow: '1',
  };
}

function seedOrderData(userId: string, orderNumber: string) {
  return {
    orderNumber,
    userId,
    address: '1 Test Street',
    zone: 'Maitumbi',
    serviceType: 'starter',
    serviceTotalKobo: 200_000n,
    grandTotalKobo: 300_000n,
    paymentMethod: 'transfer',
    status: 'initiated',
  } as const;
}

afterAll(async () => {
  await prisma.order.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('order.repository — createInitiatedOrder order-number generation', () => {
  it('derives the next number from the max existing WM-NNN value, ignoring non-standard order-number formats', async () => {
    const user = await prisma.user.create({ data: { phoneNumber: basePhoneNumber } });
    createdUserIds.push(user.id);

    // A high, deterministic WM-NNN row so the assertion doesn't depend on however many
    // real orders already exist in the table from other tests.
    const seeded = await prisma.order.create({ data: seedOrderData(user.id, 'WM-900') });
    // A non-standard order-number format, exactly like keywordProtocol.e2e.test.ts and
    // notification.service.test.ts create for their own setup — this is the exact shape
    // of row that made the bug (a template-literal \d-vs-\\d escaping mistake, which
    // made MAX() silently ignore every real WM-NNN row too) produce a colliding number.
    const nonStandard = await prisma.order.create({
      data: seedOrderData(user.id, 'WM-E2E-9999999999999'),
    });
    createdOrderIds.push(seeded.id, nonStandard.id);

    const created = await createInitiatedOrder(baseInput(user.id));
    createdOrderIds.push(created.id);

    // With the bug (MAX() always returning 0 because the regex never matched anything,
    // even against the real "WM-900" row), this would incorrectly be "WM-001".
    expect(created.orderNumber).toBe('WM-901');
  });

  it('still produces a valid, non-colliding WM-NNN number when only non-standard rows exist', async () => {
    const user = await prisma.user.create({ data: { phoneNumber: `${basePhoneNumber}9` } });
    createdUserIds.push(user.id);

    const nonStandard = await prisma.order.create({
      data: seedOrderData(user.id, `WM-ONLY-NONSTANDARD-${Date.now()}`),
    });
    createdOrderIds.push(nonStandard.id);

    const created = await createInitiatedOrder(baseInput(user.id));
    createdOrderIds.push(created.id);

    expect(created.orderNumber).toMatch(/^WM-\d{3,}$/);
  });
});
