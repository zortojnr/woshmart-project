import { cancelQuoteTimeoutJob, scheduleQuoteTimeoutJob } from '../jobs/sessionTimeout.job';
import { logger } from '../lib/logger';
import { sendMessage } from '../messaging/send.service';
import { MEDIA_NOT_SUPPORTED_MESSAGE } from './messages';
import { loadOrCreateSession, saveSession } from './session.repository';
import { addressCollectionHandler } from './states/addressCollection';
import { awaitingPaymentHandler } from './states/payment';
import { coverageCheckHandler } from './states/coverageCheck';
import { feedbackHandler } from './states/feedback';
import { paymentMethodHandler } from './states/paymentMethod';
import { pickupTimeHandler } from './states/pickupTime';
import { quoteHandler } from './states/quote';
import { serviceSelectionHandler } from './states/serviceSelection';
import { welcomeHandler } from './states/welcome';
import type { ConversationState, SessionContext, StateHandler } from './types';

// Pure orchestration: load session -> dispatch to state handler -> persist -> side
// effects -> send. No business logic here — that lives in the individual state
// handlers under conversation/states/.
const HANDLERS: Partial<Record<ConversationState, StateHandler>> = {
  WELCOME: welcomeHandler,
  COVERAGE_CHECK: coverageCheckHandler,
  SERVICE_SELECTION: serviceSelectionHandler,
  ADDRESS_COLLECTION: addressCollectionHandler,
  PICKUP_TIME: pickupTimeHandler,
  PAYMENT_METHOD: paymentMethodHandler,
  QUOTE_PENDING: quoteHandler,
  AWAITING_PAYMENT: awaitingPaymentHandler,
  FEEDBACK_PENDING: feedbackHandler,
};

export async function processInboundMessage(
  phoneNumber: string,
  body: string,
  hasMedia = false,
): Promise<void> {
  const session = await loadOrCreateSession(phoneNumber);
  const loadedCtx: SessionContext = {
    phoneNumber,
    state: session.state,
    context: session.context,
  };

  // IDLE has no handler by design (a completed/declined/COD-confirmed order has
  // nothing left to say), and any other state with no registered handler is either not
  // implemented yet or a corrupted session — both cases default safely back to WELCOME
  // rather than silently dropping the customer's message (docs/BUILD_SCRIPT.md Phase 3).
  const needsReset = loadedCtx.state === 'IDLE' || !HANDLERS[loadedCtx.state];
  if (needsReset && loadedCtx.state !== 'IDLE') {
    logger.warn({ phoneNumber, state: loadedCtx.state }, 'Session in an unhandled state — resetting to WELCOME');
  }

  const ctx: SessionContext = needsReset ? { phoneNumber, state: 'WELCOME', context: {} } : loadedCtx;
  const handler = HANDLERS[ctx.state] ?? welcomeHandler;

  // Unexpected media (a photo, etc.) outside AWAITING_PAYMENT gets a polite text-only
  // reply plus a repeat of the current prompt, rather than being fed into a handler
  // that expects text (docs/BUILD_SCRIPT.md Phase 3). Only gated once a prompt has
  // actually been sent in this session — a media-only first contact just proceeds
  // normally (WELCOME ignores input content anyway).
  const lastPromptSent = typeof ctx.context.__lastPromptSent === 'string' ? ctx.context.__lastPromptSent : null;
  if (hasMedia && ctx.state !== 'AWAITING_PAYMENT' && lastPromptSent) {
    await sendMessage({ to: phoneNumber, body: MEDIA_NOT_SUPPORTED_MESSAGE });
    await sendMessage({ to: phoneNumber, body: lastPromptSent });
    return;
  }

  const result = await handler.handle(ctx, body);

  const lastOutbound = result.outboundMessages[result.outboundMessages.length - 1];
  const nextContext = lastOutbound
    ? { ...result.nextContext, __lastPromptSent: lastOutbound.body }
    : result.nextContext;

  await saveSession(phoneNumber, result.nextState, nextContext);

  // 30-min quote-abandon timeout (docs/PRD.md §8): scheduled/cancelled by state
  // transition, not by order status — no order exists yet at QUOTE_PENDING
  // (order.service.ts creates the order only on YES). A deterministic jobId makes
  // re-entering QUOTE_PENDING via an unmatched reply a no-op, not a reset of the
  // 30-minute window, so this runs unconditionally rather than only on the first entry.
  if (result.nextState === 'QUOTE_PENDING') {
    await scheduleQuoteTimeoutJob(phoneNumber);
  } else if (ctx.state === 'QUOTE_PENDING') {
    await cancelQuoteTimeoutJob(phoneNumber);
  }

  for (const message of result.outboundMessages) {
    await sendMessage({ to: phoneNumber, body: message.body });
  }

  // Side effects (e.g. MARK_WAITLISTED, RECEIPT_HELD) beyond logging are wired up as
  // the domains that own them are implemented in later phases.
  if (result.sideEffects && result.sideEffects.length > 0) {
    logger.info({ phoneNumber, sideEffects: result.sideEffects }, 'Conversation side effects emitted');
  }
}
