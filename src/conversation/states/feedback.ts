import { recordFeedback } from '../../domain/orders/order.service';
import { logger } from '../../lib/logger';
import { handleUnmatchedInput } from '../fallback';
import { FEEDBACK_PROMPT_MESSAGE, FEEDBACK_RESPONSE_MESSAGES } from '../messages';
import type { HandlerResult, SessionContext, StateHandler } from '../types';

interface FeedbackPendingContext {
  orderId?: string;
}

function matchScore(input: string): 1 | 2 | 3 | null {
  const trimmed = input.trim();
  if (trimmed === '1') return 1;
  if (trimmed === '2') return 2;
  if (trimmed === '3') return 3;
  return null;
}

// FEEDBACK_PENDING (PRD.md §10 feedback prompt, TRD.md §3: "Score 1/2/3 → logged →
// IDLE"). Entry into this state is Phase 4's job (the Woshman DELIVERED keyword sets
// it, with orderId in context) — this handler only reacts to a reply once already here.
export const feedbackHandler: StateHandler = {
  async handle(ctx: SessionContext, input: string): Promise<HandlerResult> {
    const context = ctx.context as FeedbackPendingContext;
    const score = matchScore(input);

    if (!score) {
      return handleUnmatchedInput(ctx.phoneNumber, 'FEEDBACK_PENDING', ctx.context, FEEDBACK_PROMPT_MESSAGE);
    }

    if (!context.orderId) {
      logger.error({ phoneNumber: ctx.phoneNumber }, 'FEEDBACK_PENDING reached with no orderId in context — cannot record feedback');
      return { nextState: 'IDLE', nextContext: {}, outboundMessages: [] };
    }

    await recordFeedback(context.orderId, score);

    if (score === 3) {
      // PRD.md §10: "COO tagged immediately, urgent." No paging infra exists yet
      // (Phase 6/7) — logging loudly is the interim equivalent, per CLAUDE.md's
      // alerting philosophy (visible for business-hours review, not a page).
      logger.error(
        { phoneNumber: ctx.phoneNumber, orderId: context.orderId },
        'URGENT: customer reported a serious feedback issue (score 3) — needs COO follow-up',
      );
    }

    return {
      nextState: 'IDLE',
      nextContext: {},
      outboundMessages: [{ body: FEEDBACK_RESPONSE_MESSAGES[score] }],
    };
  },
};
