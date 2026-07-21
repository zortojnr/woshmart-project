import type { BundleId } from '../../domain/pricing/bundles.config';
import { getPickupWindowByMenuReply } from '../../domain/orders/pickupWindows.config';
import { handleUnmatchedInput } from '../fallback';
import { PAYMENT_METHOD_MESSAGE, PICKUP_TIME_MESSAGE } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface PickupTimeContext {
  area?: string;
  bundleId?: BundleId;
  address?: string;
}

export const pickupTimeHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as PickupTimeContext;
    const window = getPickupWindowByMenuReply(input);

    if (!window) {
      return handleUnmatchedInput(ctx.phoneNumber, 'PICKUP_TIME', ctx.context, PICKUP_TIME_MESSAGE);
    }

    return {
      nextState: 'PAYMENT_METHOD',
      nextContext: { ...context, pickupWindowId: window.id },
      outboundMessages: [{ body: PAYMENT_METHOD_MESSAGE }],
    };
  },
};
