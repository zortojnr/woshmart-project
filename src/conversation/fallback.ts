// Shared unmatched-input tracking used by state handlers (Phase 3 onward): unmatched
// input re-prompts with the current stage's message; 3 consecutive unmatched inputs
// escalate and flag the session for COO visibility (docs/BUILD_SCRIPT.md Phase 3).
//
// Not applied retroactively to the Phase 2 WELCOME/COVERAGE_CHECK handlers — those
// already shipped their own (different, reviewed) fallback behavior; this is additive
// for the states built in this phase.
import { logger } from '../lib/logger';
import { ESCALATION_FALLBACK_MESSAGE } from './messages';
import type { ConversationState, HandlerResult } from './types';

export const MAX_UNMATCHED_ATTEMPTS = 3;

export function handleUnmatchedInput(
  phoneNumber: string,
  state: ConversationState,
  context: Record<string, unknown>,
  currentStagePromptBody: string,
): HandlerResult {
  const priorCount = typeof context.unmatchedCount === 'number' ? context.unmatchedCount : 0;
  const count = priorCount + 1;

  if (count >= MAX_UNMATCHED_ATTEMPTS) {
    logger.warn(
      { phoneNumber, state, unmatchedAttempts: count },
      'Session flagged for COO visibility after repeated unmatched input',
    );
    return {
      nextState: state,
      nextContext: { ...context, unmatchedCount: 0, flaggedForCoo: true },
      outboundMessages: [{ body: ESCALATION_FALLBACK_MESSAGE }],
    };
  }

  return {
    nextState: state,
    nextContext: { ...context, unmatchedCount: count },
    outboundMessages: [{ body: currentStagePromptBody }],
  };
}
