// Order creation and lifecycle orchestration. Order creation happens on YES-confirmation
// from QUOTE_PENDING (docs/TRD.md §3) — never earlier. Every status write goes through
// order.statemachine.ts, never a raw update here (CLAUDE.md rule 4).
import type { Feedback, Order } from '@prisma/client';
import { prisma } from '../../db/client';
import type { BundleId } from '../pricing/bundles.config';
import { computeQuote } from '../pricing/pricing.service';
import { findOrCreateUserByPhone } from '../users/user.service';
import { createInitiatedOrder } from './order.repository';
import { transitionOrderStatus } from './order.statemachine';
import { resolvePickupDate, type PickupWindowOption } from './pickupWindows.config';

export interface CreateOrderFromQuoteInput {
  phoneNumber: string;
  zone: string;
  address: string;
  bundleId: BundleId;
  pickupWindow: PickupWindowOption;
  paymentMethod: 'transfer' | 'cod';
}

// PRD.md §9: both transfer and COD orders land at the single `awaiting_payment` status
// on YES — for transfer that means "payment request sent", for COD it means "order
// confirmed" (cash collected later at delivery). The conversation FSM's next state
// differs (AWAITING_PAYMENT vs IDLE per TRD.md §3), but the order status is the same
// either way; PAID is a separate, later COO action (Phase 5) for both payment methods.
export async function createOrderFromQuote(input: CreateOrderFromQuoteInput): Promise<Order> {
  const user = await findOrCreateUserByPhone(input.phoneNumber);
  const quote = computeQuote(input.bundleId);

  const order = await createInitiatedOrder({
    userId: user.id,
    address: input.address,
    zone: input.zone,
    serviceType: input.bundleId,
    itemsDescription: quote.bundle.itemsLabel,
    serviceTotalKobo: quote.serviceTotalKobo,
    smallBasketFeeKobo: quote.smallBasketFeeKobo,
    logisticsFeeKobo: quote.logisticsFeeKobo,
    grandTotalKobo: quote.grandTotalKobo,
    paymentMethod: input.paymentMethod,
    pickupDate: resolvePickupDate(input.pickupWindow),
    pickupWindow: input.pickupWindow.id,
  });

  await transitionOrderStatus(order.id, 'awaiting_confirmation', 'system', 'Quote sent, awaiting YES/NO');
  return transitionOrderStatus(order.id, 'awaiting_payment', 'system', 'YES received');
}

// FEEDBACK_PENDING (PRD.md §10 feedback prompt) records the score here — the only
// place a Feedback row gets written, matching the "handlers never touch Postgres
// directly" rule (CLAUDE.md / ARCHITECTURE.md §4).
export async function recordFeedback(orderId: string, score: 1 | 2 | 3): Promise<Feedback> {
  return prisma.feedback.create({ data: { orderId, score } });
}

// Looked up by the human-facing order_number (WM-NNN) — that's what Woshmen/partners
// type via the keyword protocol (docs/TRD.md §4), not the internal id. Includes the
// relations the notification service needs to know who to message.
export async function findOrderByNumber(orderNumber: string) {
  return prisma.order.findUnique({
    where: { orderNumber },
    include: { user: true, woshman: true, partner: true },
  });
}

// ISSUE (docs/TRD.md §4: "Flags order, no status change"). Appends to the existing
// notes field rather than overwriting it — never touches orders.status, so this isn't
// subject to the statemachine's legal-transition rule (CLAUDE.md rule 4 is specifically
// about orders.status).
export async function flagOrderIssue(orderId: string, note: string, reportedBy: string): Promise<Order> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ISSUE from ${reportedBy}: ${note}`;
  const notes = order.notes ? `${order.notes}\n${entry}` : entry;

  return prisma.order.update({ where: { id: orderId }, data: { notes } });
}
