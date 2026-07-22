// Order persistence (Prisma). Status writes go exclusively through
// order.statemachine.ts (CLAUDE.md rule 4), never through this file.
import type { Order, Prisma } from '@prisma/client';
import { prisma } from '../../db/client';
import type { OrderStatus } from './order.types';

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
// from the highest existing "WM-NNN"-formatted number, not a plain row count — a plain
// count is only safe if every single row in the table follows this exact numbering
// scheme, which doesn't hold (test fixtures create orders with other id formats; a
// future data migration or manual seed could too). Serialized with a Postgres advisory
// lock scoped to the transaction so two concurrent creators can't both compute the
// same "next" number; the retry loop is a defensive fallback, not the primary safeguard.
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
    try {
      return await prisma.$transaction(async (tx) => {
        // Advisory lock held for the transaction's duration — any other concurrent
        // caller using the same key blocks here until this transaction commits, so
        // the read-max-then-create below can't race with another order creation.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('woshmart_order_number'))`;

        // Note: "\\d" (not "\d") — inside a JS template literal, \d isn't a recognized
        // escape sequence, so JS silently drops the backslash before this ever reaches
        // Postgres. Without the double backslash, the regex Postgres actually sees is
        // "^WM-d+$" (literal "d"), which never matches any real order number, so MAX()
        // always returns 0 and every call computes the same "WM-001".
        const [{ max_num: maxNum }] = await tx.$queryRaw<[{ max_num: number }]>`
          SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM '^WM-(\\d+)$') AS INTEGER)), 0) AS max_num
          FROM orders
          WHERE order_number ~ '^WM-\\d+$'
        `;
        const orderNumber = `WM-${String(maxNum + 1).padStart(3, '0')}`;

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

export interface OrderListFilters {
  status?: OrderStatus | undefined;
  zone?: string | undefined;
  woshmanId?: string | undefined;
  partnerId?: string | undefined;
}

// docs/TRD.md §5.2 GET /admin/orders — "List/filter orders". Newest first; no pagination
// specified, so none added speculatively (CLAUDE.md rule 10).
export async function listOrders(filters: OrderListFilters) {
  return prisma.order.findMany({
    where: {
      ...(filters.status !== undefined ? { status: filters.status } : {}),
      ...(filters.zone !== undefined ? { zone: filters.zone } : {}),
      ...(filters.woshmanId !== undefined ? { woshmanId: filters.woshmanId } : {}),
      ...(filters.partnerId !== undefined ? { partnerId: filters.partnerId } : {}),
    },
    include: { user: true, woshman: true, partner: true },
    orderBy: { createdAt: 'desc' },
  });
}

// docs/TRD.md §5.2 GET /admin/orders/:id — "Order detail + status history".
export async function getOrderDetail(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      user: true,
      woshman: true,
      partner: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
}
