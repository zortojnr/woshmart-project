import type { BundleId } from '../../domain/pricing/bundles.config';
import { getBundle } from '../../domain/pricing/pricing.service';
import { handleUnmatchedInput } from '../fallback';
import { addressRequestMessage, PICKUP_TIME_MESSAGE } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface AddressCollectionContext {
  area?: string;
  bundleId?: BundleId;
}

export const addressCollectionHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as AddressCollectionContext;
    const address = input.trim();

    if (address.length === 0) {
      const bundle = context.bundleId ? getBundle(context.bundleId) : null;
      const reprompt = bundle ? addressRequestMessage(bundle.name, bundle.priceKobo) : PICKUP_TIME_MESSAGE;
      return handleUnmatchedInput(ctx.phoneNumber, 'ADDRESS_COLLECTION', ctx.context, reprompt);
    }

    return {
      nextState: 'PICKUP_TIME',
      nextContext: { area: context.area, bundleId: context.bundleId, address },
      outboundMessages: [{ body: PICKUP_TIME_MESSAGE }],
    };
  },
};
