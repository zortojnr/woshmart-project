// Orchestrates a single Woshman/partner keyword message end to end: parse -> validate
// sender permission -> look up the order -> apply the transition through
// order.statemachine.ts (the ONLY thing allowed to write orders.status, CLAUDE.md rule
// 4) -> fan out the resulting notification via domain/notifications -> reply to the
// sender on anything that didn't succeed. Never a silent drop (docs/BUILD_SCRIPT.md
// Phase 4): malformed keyword, unknown order, wrong sender type, and illegal
// transitions all get a clear WhatsApp reply back to whoever sent the message.
import { saveSession } from '../conversation/session.repository';
import {
  alreadyAtStatusMessage,
  illegalKeywordTransitionMessage,
  keywordNotAllowedForSenderMessage,
  MALFORMED_KEYWORD_MESSAGE,
  unknownOrderMessage,
} from '../conversation/messages';
import { flagOrderIssue, findOrderByNumber } from '../domain/orders/order.service';
import { IllegalOrderTransitionError, transitionOrderStatus } from '../domain/orders/order.statemachine';
import type { OrderStatus } from '../domain/orders/order.types';
import { notify, type NotificationEvent } from '../domain/notifications/notification.service';
import { logger } from '../lib/logger';
import { parseKeywordCommand } from './keyword.parser';
import { sendMessage } from './send.service';

export type KeywordSenderType = 'woshman' | 'partner';

// Keyword -> (allowed sender, target order status or null for no status change, the
// notification event fired on success). "READY" is partner-only per docs/TRD.md §4
// ("Sent by partner, not Woshman"); everything else is Woshman-only except ISSUE, which
// either can send (docs/PRD.md §11.7: partners escalate SLA-risk issues directly too).
const KEYWORD_RULES: Record<
  string,
  { allowedSenders: KeywordSenderType[]; targetStatus: OrderStatus | null; event: NotificationEvent | null }
> = {
  COLLECTED: { allowedSenders: ['woshman'], targetStatus: 'picked_up', event: 'PICKED_UP' },
  LAUNDRY: { allowedSenders: ['woshman'], targetStatus: 'at_laundry', event: 'AT_LAUNDRY' },
  READY: { allowedSenders: ['partner'], targetStatus: 'ready_for_delivery', event: 'READY_FOR_DELIVERY' },
  DELIVERING: { allowedSenders: ['woshman'], targetStatus: 'out_for_delivery', event: 'OUT_FOR_DELIVERY' },
  DELIVERED: { allowedSenders: ['woshman'], targetStatus: 'delivered', event: 'DELIVERED' },
  ISSUE: { allowedSenders: ['woshman', 'partner'], targetStatus: null, event: null },
};

export async function handleKeywordMessage(
  senderType: KeywordSenderType,
  senderPhoneNumber: string,
  body: string,
): Promise<void> {
  const parsed = parseKeywordCommand(body);
  if (!parsed) {
    logger.warn({ senderType, senderPhoneNumber }, 'Malformed keyword message');
    await sendMessage({ to: senderPhoneNumber, body: MALFORMED_KEYWORD_MESSAGE });
    return;
  }

  const rule = KEYWORD_RULES[parsed.type]!;
  if (!rule.allowedSenders.includes(senderType)) {
    logger.warn(
      { senderType, senderPhoneNumber, keyword: parsed.type, orderNumber: parsed.orderNumber },
      'Keyword rejected — not allowed from this sender type',
    );
    await sendMessage({ to: senderPhoneNumber, body: keywordNotAllowedForSenderMessage(parsed.type) });
    return;
  }

  const order = await findOrderByNumber(parsed.orderNumber);
  if (!order) {
    logger.warn({ senderType, senderPhoneNumber, orderNumber: parsed.orderNumber }, 'Keyword references an unknown order');
    await sendMessage({ to: senderPhoneNumber, body: unknownOrderMessage(parsed.orderNumber) });
    return;
  }

  if (parsed.type === 'ISSUE') {
    await flagOrderIssue(order.id, parsed.note, senderType);
    logger.error(
      { orderId: order.id, orderNumber: order.orderNumber, senderType, note: parsed.note },
      'URGENT: ISSUE reported on order — needs immediate COO attention',
    );
    return;
  }

  // The statemachine treats re-requesting the status an order is already at as an
  // idempotent no-op (order.statemachine.ts) — correct for the write itself, but a
  // retried/duplicate keyword must not re-fire the notification fan-out a second time
  // (CLAUDE.md rule 6). Checked here, before the write, using the order already in hand.
  // The sender still gets a short acknowledgement rather than silence — same reasoning
  // as the Phase 3 waitlist-decline fix, not a bigger escalation/retry feature.
  if (order.status === rule.targetStatus) {
    logger.info(
      { orderId: order.id, orderNumber: order.orderNumber, status: order.status },
      'Keyword is a no-op — order already at the target status, skipping duplicate notification',
    );
    await sendMessage({ to: senderPhoneNumber, body: alreadyAtStatusMessage(order.orderNumber, order.status) });
    return;
  }

  const note =
    parsed.type === 'DELIVERED' ? `Delivered, ${parsed.count}pcs confirmed` : `${parsed.type} keyword from ${senderType}`;

  try {
    await transitionOrderStatus(order.id, rule.targetStatus!, senderType, note);
  } catch (err) {
    if (err instanceof IllegalOrderTransitionError) {
      await sendMessage({ to: senderPhoneNumber, body: illegalKeywordTransitionMessage(order.orderNumber, order.status) });
      return;
    }
    throw err;
  }

  await notify(rule.event!, order.id);

  if (parsed.type === 'DELIVERED') {
    // PRD.md flow step 10: "On delivery, feedback prompt sent automatically" — notify()
    // above already sent the prompt; this puts the customer's session into the state
    // that actually parses their 1/2/3 reply (Phase 3's feedbackHandler).
    await saveSession(order.user.phoneNumber, 'FEEDBACK_PENDING', { orderId: order.id });
  }
}
