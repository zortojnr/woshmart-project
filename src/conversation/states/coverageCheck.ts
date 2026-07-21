import { matchZone } from '../../domain/zones/zone.service';
import { coverageConfirmedMessage, outOfCoverageMessage } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface CoverageCheckContext {
  awaitingWaitlistConfirmation?: boolean;
  area?: string;
}

function isYes(input: string): boolean {
  return /^\s*y(es)?\s*$/i.test(input);
}

// COVERAGE_CHECK handles two shapes of input depending on session context:
//   1. First turn — customer states an area. In-coverage -> bundle menu, advance to
//      SERVICE_SELECTION. Out-of-coverage (waitlist zone, not-yet-available zone, or
//      anything unrecognized) -> waitlist offer, stay in COVERAGE_CHECK awaiting YES/NO.
//   2. Second turn (awaitingWaitlistConfirmation) — YES logs the waitlist entry
//      (PRD.md §11.1: "Accepted waitlist entries are logged against the customer
//      record") and ends the flow at IDLE. Anything else also ends at IDLE without
//      logging — PRD.md §10 has no specified copy for either reply, so none is sent.
export const coverageCheckHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as CoverageCheckContext;

    if (context.awaitingWaitlistConfirmation) {
      const sideEffects = isYes(input)
        ? [{ type: 'MARK_WAITLISTED', payload: { area: context.area ?? null } }]
        : undefined;

      return {
        nextState: 'IDLE',
        nextContext: {},
        outboundMessages: [],
        ...(sideEffects ? { sideEffects } : {}),
      };
    }

    const match = matchZone(input);
    const area = match.canonicalName ?? input.trim();

    if (match.status === 'full') {
      return {
        nextState: 'SERVICE_SELECTION',
        nextContext: { area },
        outboundMessages: [{ body: coverageConfirmedMessage(area) }],
      };
    }

    return {
      nextState: 'COVERAGE_CHECK',
      nextContext: { awaitingWaitlistConfirmation: true, area },
      outboundMessages: [{ body: outOfCoverageMessage(area) }],
    };
  },
};
