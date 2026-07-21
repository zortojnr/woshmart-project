import { logger } from '../lib/logger';
import { sendMessage } from '../messaging/send.service';
import { loadOrCreateSession, saveSession } from './session.repository';
import { coverageCheckHandler } from './states/coverageCheck';
import { welcomeHandler } from './states/welcome';
import type { ConversationState, SessionContext, StateHandler } from './types';

// Pure orchestration: load session -> dispatch to state handler -> persist -> side
// effects -> send. No business logic here — that lives in the individual state
// handlers under conversation/states/.
const HANDLERS: Partial<Record<ConversationState, StateHandler>> = {
  WELCOME: welcomeHandler,
  COVERAGE_CHECK: coverageCheckHandler,
};

export async function processInboundMessage(phoneNumber: string, body: string): Promise<void> {
  const session = await loadOrCreateSession(phoneNumber);
  const ctx: SessionContext = {
    phoneNumber,
    state: session.state,
    context: session.context,
  };

  const handler = HANDLERS[ctx.state];
  if (!handler) {
    // States beyond COVERAGE_CHECK aren't implemented yet (Phase 3+) — a session that
    // reaches one of them mid-flow falls through here rather than crashing. Nothing to
    // persist or send; logged so it's visible for the phase that implements the state.
    logger.error({ phoneNumber, state: ctx.state }, 'No conversation handler registered for state');
    return;
  }

  const result = await handler.handle(ctx, body);

  await saveSession(phoneNumber, result.nextState, result.nextContext);

  for (const message of result.outboundMessages) {
    await sendMessage({ to: phoneNumber, body: message.body });
  }

  // Side effects (e.g. MARK_WAITLISTED) beyond logging are wired up as the domains
  // that own them are implemented in later phases.
  if (result.sideEffects && result.sideEffects.length > 0) {
    logger.info({ phoneNumber, sideEffects: result.sideEffects }, 'Conversation side effects emitted');
  }
}
