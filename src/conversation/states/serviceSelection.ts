import { getBundleByMenuReply } from '../../domain/pricing/bundles.config';
import { logger } from '../../lib/logger';
import { handleUnmatchedInput } from '../fallback';
import { addressRequestMessage, coverageConfirmedMessage } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface ServiceSelectionContext {
  area?: string;
}

export const serviceSelectionHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as ServiceSelectionContext;
    const area = context.area;
    if (!area) {
      // Shouldn't happen via the normal COVERAGE_CHECK -> SERVICE_SELECTION path, which
      // always sets area — defensive fallback rather than crashing on a corrupted session.
      logger.error({ phoneNumber: ctx.phoneNumber }, 'SERVICE_SELECTION reached with no area in context');
    }

    const bundle = getBundleByMenuReply(input);
    if (!bundle) {
      return handleUnmatchedInput(ctx.phoneNumber, 'SERVICE_SELECTION', ctx.context, coverageConfirmedMessage(area ?? ''));
    }

    return {
      nextState: 'ADDRESS_COLLECTION',
      nextContext: { area, bundleId: bundle.id },
      outboundMessages: [{ body: addressRequestMessage(bundle.name, bundle.priceKobo) }],
    };
  },
};
