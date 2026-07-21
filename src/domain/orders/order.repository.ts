// Order persistence (Prisma). Order creation only — status writes go exclusively
// through order.statemachine.ts (CLAUDE.md rule 4), never through this file.
import type { Order, Prisma } from '@prisma/client';
import { prisma } from '../../db/client';

const ORDER_NUMBER_CREATION_ATTEMPTS = 5;

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
// from the current order count. At this system's real scale (low hundreds/month, per
// TRD.md §6 scalability notes) a genuine concurrent collision is rare, but not
// impossible — retry a few times on a unique-constraint conflict rather than assuming
// count+1 is always free.
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

  let lastError: unknown;
  for (let attempt = 0; attempt < ORDER_NUMBER_CREATION_ATTEMPTS; attempt++) {
    const count = await prisma.order.count();
    const orderNumber = `WM-${String(count + 1).padStart(3, '0')}`;

    try {
      return await prisma.order.create({ data: { ...data, orderNumber } });
    } catch (err) {
      lastError = err;
      if (!isUniqueConstraintViolation(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}
