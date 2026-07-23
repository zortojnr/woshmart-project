import type { BundleId } from '../../domain/pricing/bundles.config';
import { getPickupWindowByMenuReply } from '../../domain/orders/pickupWindows.config';
import { createOrderFromQuote } from '../../domain/orders/order.service';
import { logger } from '../../lib/logger';
import { handleUnmatchedInput } from '../fallback';
import {
  bankTransferInstructionsMessage,
  codConfirmationMessage,
  quoteMessageForBundle,
} from '../messages';
import { isNo, isYes } from '../replyMatchers';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface QuotePendingContext {
  area?: string;
  bundleId?: BundleId;
  address?: string;
  pickupWindowId?: string;
  paymentMethod?: 'transfer' | 'cod';
}

function hasCompleteOrderDraft(
  context: QuotePendingContext,
): context is Required<QuotePendingContext> {
  return Boolean(context.area && context.bundleId && context.address && context.pickupWindowId && context.paymentMethod);
}

// QUOTE_PENDING (docs/TRD.md §3, PRD.md flow step 7-8): YES creates the order row (the
// ONLY place order creation happens) and routes to AWAITING_PAYMENT (transfer) or IDLE
// (COD — nothing more for the customer to do conversationally). NO cancels with no
// order created and no PRD-specified reply copy, matching the Phase 2 precedent for the
// waitlist decline (no message invented where PRD doesn't supply one).
export const quoteHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as QuotePendingContext;

    if (isNo(input)) {
      return { nextState: 'IDLE', nextContext: {}, outboundMessages: [] };
    }

    if (!isYes(input)) {
      if (!context.bundleId) {
        // Can't be reached via the normal flow (PAYMENT_METHOD always sets bundleId
        // before QUOTE_PENDING) — defensive bail rather than crashing or sending
        // reconstructed-from-nothing copy.
        logger.error({ phoneNumber: ctx.phoneNumber }, 'QUOTE_PENDING reached with no bundleId in context');
        return { nextState: 'IDLE', nextContext: {}, outboundMessages: [] };
      }
      return handleUnmatchedInput(ctx.phoneNumber, 'QUOTE_PENDING', ctx.context, quoteMessageForBundle(context.bundleId));
    }

    if (!hasCompleteOrderDraft(context)) {
      // Log which fields are missing, not the context itself — it can hold the
      // customer's street address, which has no reason to sit in a long-retention
      // log at error level (docs/TRD.md §7 PII handling).
      logger.error(
        {
          phoneNumber: ctx.phoneNumber,
          missingFields: {
            area: !context.area,
            bundleId: !context.bundleId,
            address: !context.address,
            pickupWindowId: !context.pickupWindowId,
            paymentMethod: !context.paymentMethod,
          },
        },
        'QUOTE_PENDING YES with an incomplete order draft — cannot create order',
      );
      return { nextState: 'IDLE', nextContext: {}, outboundMessages: [] };
    }

    const pickupWindow = getPickupWindowByMenuReply(context.pickupWindowId);
    if (!pickupWindow) {
      logger.error({ phoneNumber: ctx.phoneNumber, pickupWindowId: context.pickupWindowId }, 'QUOTE_PENDING: stored pickupWindowId does not resolve to a known window');
      return { nextState: 'IDLE', nextContext: {}, outboundMessages: [] };
    }

    const order = await createOrderFromQuote({
      phoneNumber: ctx.phoneNumber,
      zone: context.area,
      address: context.address,
      bundleId: context.bundleId,
      pickupWindow,
      paymentMethod: context.paymentMethod,
    });

    const grandTotalKobo = Number(order.grandTotalKobo);

    if (context.paymentMethod === 'transfer') {
      return {
        nextState: 'AWAITING_PAYMENT',
        nextContext: { orderId: order.id },
        outboundMessages: [{ body: bankTransferInstructionsMessage(grandTotalKobo) }],
      };
    }

    return {
      nextState: 'IDLE',
      nextContext: {},
      outboundMessages: [{ body: codConfirmationMessage(grandTotalKobo, pickupWindow.label) }],
    };
  },
};
