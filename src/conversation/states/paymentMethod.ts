import type { BundleId } from '../../domain/pricing/bundles.config';
import { logger } from '../../lib/logger';
import { handleUnmatchedInput } from '../fallback';
import { PAYMENT_METHOD_MESSAGE, quoteMessageForBundle } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface PaymentMethodContext {
  area?: string;
  bundleId?: BundleId;
  address?: string;
  pickupWindowId?: string;
}

function matchPaymentMethod(input: string): 'transfer' | 'cod' | null {
  const trimmed = input.trim();
  if (trimmed === '1') return 'transfer';
  if (trimmed === '2') return 'cod';
  return null;
}

export const paymentMethodHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as PaymentMethodContext;
    const paymentMethod = matchPaymentMethod(input);

    if (!paymentMethod) {
      return handleUnmatchedInput(ctx.phoneNumber, 'PAYMENT_METHOD', ctx.context, PAYMENT_METHOD_MESSAGE);
    }

    if (!context.bundleId) {
      logger.error({ phoneNumber: ctx.phoneNumber }, 'PAYMENT_METHOD reached with no bundleId in context');
      return handleUnmatchedInput(ctx.phoneNumber, 'PAYMENT_METHOD', ctx.context, PAYMENT_METHOD_MESSAGE);
    }

    return {
      nextState: 'QUOTE_PENDING',
      nextContext: { ...context, paymentMethod },
      outboundMessages: [{ body: quoteMessageForBundle(context.bundleId) }],
    };
  },
};
