// Order persistence (Prisma). Order creation only — status writes go exclusively
// through order.statemachine.ts (CLAUDE.md rule 4), never through this file.
import type { Order, Prisma } from '@prisma/client';
import { prisma } from '../../db/client';

const ORDER_NUMBER_CREATION_ATTEMPTS = 3;

export interface CreateInitiatedOrderInput {
  userId: string;
  address: string;
  landmark?: string | null;
  zone: string;
  serviceType: string;
  itemsDescription: string;
  serviceTotalKobo: number;
  smallBasketFeeKobo: number;
  logisticsFeeKobo: number;
  grandTotalKobo: number;
  paymentMethod: 'transfer' | 'cod';
  pickupDate: Date;
  pickupWindow: string;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

// Human-facing order numbers are sequential ("WM-001", per DATABASE_SCHEMA.md), derived
// from the current order count. A plain count-then-create race is real under
// concurrency (caught by concurrent test suite load, not yet in production, but the
// same race exists there too) — serialized with a Postgres advisory lock scoped to the
// transaction, rather than a schema change/new sequence table. The retry loop stays as
// a defensive fallback, not the primary safeguard.
export async function createInitiatedOrder(input: CreateInitiatedOrderInput): Promise<Order> {
  const data: Prisma.OrderCreateInput = {
    user: { connect: { id: input.userId } },
    address: input.address,
    landmark: input.landmark ?? null,
    zone: input.zone,
    serviceType: input.serviceType,
    itemsDescription: input.itemsDescription,
    serviceTotalKobo: BigInt(input.serviceTotalKobo),
    smallBasketFeeKobo: BigInt(input.smallBasketFeeKobo),
    logisticsFeeKobo: BigInt(input.logisticsFeeKobo),
    grandTotalKobo: BigInt(input.grandTotalKobo),
    paymentMethod: input.paymentMethod,
    pickupDate: input.pickupDate,
    pickupWindow: input.pickupWindow,
    status: 'initiated',
    orderNumber: '', // set per attempt below
  };

  // eslint-disable-next-line no-console
  console.error('TEMP-DEBUG existing order numbers before create:', (await prisma.order.findMany({ select: { orderNumber: true } })).map((o) => o.orderNumber));

  let lastError: unknown;
  for (let attempt = 0; attempt < ORDER_NUMBER_CREATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Advisory lock held for the transaction's duration — any other concurrent
        // caller using the same key blocks here until this transaction commits, so
        // the count-then-create below can't race with another order creation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('woshmart_order_number'))`;
        const count = await tx.order.count();
        const orderNumber = `WM-${String(count + 1).padStart(3, '0')}`;
        // eslint-disable-next-line no-console
        console.error('TEMP-DEBUG order-number attempt', attempt, 'count', count, 'orderNumber', orderNumber);
        return tx.order.create({ data: { ...data, orderNumber } });
      });
    } catch (err) {
      lastError = err;
      if (!isUniqueConstraintViolation(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}
