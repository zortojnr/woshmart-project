import { logger } from '../../lib/logger';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface AwaitingPaymentContext {
  orderId?: string;
}

// TRD.md §2: "Payment confirmation via bank transfer is not a customer-input
// transition — it requires a COO action through the Admin API. A submitted receipt
// just holds the session; a human moves it to PAID." So this handler never advances
// the FSM on its own — any inbound message (text or the receipt image itself) just
// holds. No PRD-specified acknowledgement copy exists for "we got your receipt", so
// none is sent (same precedent as the Phase 2 waitlist decline) — the customer was
// already told what happens next in the bank transfer instructions message.
export const awaitingPaymentHandler: StateHandler = {
  async handle(ctx: SessionContext, _input: string): Promise<HandlerResult> {
    const context = ctx.context as AwaitingPaymentContext;

    logger.info(
      { phoneNumber: ctx.phoneNumber, orderId: context.orderId },
      'Message received while AWAITING_PAYMENT — held for COO verification, no auto-transition',
    );

    return {
      nextState: 'AWAITING_PAYMENT',
      nextContext: ctx.context,
      outboundMessages: [],
      sideEffects: [{ type: 'RECEIPT_HELD', payload: { orderId: context.orderId ?? null } }],
    };
  },
};
