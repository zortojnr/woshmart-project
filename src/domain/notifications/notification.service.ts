// Single fan-out point for every outbound "event" (docs/PRD.md §12). Called by the
// keyword protocol here, and (later) any admin-triggered flow — never bypassed
// (CLAUDE.md rule 5: this is the only thing that decides "who gets told what"; it
// calls the Messaging Service, nothing else sends WhatsApp messages directly).
//
// Only the keyword-triggered events Phase 4 actually has a caller for are implemented:
// PICKED_UP, AT_LAUNDRY, READY_FOR_DELIVERY, OUT_FOR_DELIVERY, DELIVERED. The matrix's
// other rows (order confirmation, PAID, feedback, abandonment, door cancellation) are
// either already handled elsewhere (Phase 3's conversational sends) or have no caller
// yet (Phase 5 Admin API) — not retrofitted here, to keep this phase's diff scoped to
// what Phase 4 actually triggers.
import {
  dispatchConfirmationMessage,
  FEEDBACK_PROMPT_MESSAGE,
  outForDeliveryMessage,
  partnerJobBriefMessage,
  PAYMENT_WINDOW_ABANDONED_MESSAGE,
  readyForPickupAlertMessage,
  STATUS_UPDATE_MESSAGES,
  woshmanDispatchBriefMessage,
} from '../../conversation/messages';
import { logger } from '../../lib/logger';
import { sendMessage } from '../../messaging/send.service';
import { prisma } from '../../db/client';

export type NotificationEvent =
  | 'PICKED_UP'
  | 'AT_LAUNDRY'
  | 'READY_FOR_DELIVERY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'ASSIGNED'
  | 'PAYMENT_WINDOW_ABANDONED';

export async function notify(event: NotificationEvent, orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true, woshman: true, partner: true },
  });

  switch (event) {
    case 'PICKED_UP':
      // PRD.md §12: "Woshman keyword: COLLECTED | customer ✅ | COO ❌ | Woshman ❌ | Partner ❌"
      await sendMessage({ to: order.user.phoneNumber, body: STATUS_UPDATE_MESSAGES.picked_up });
      return;

    case 'AT_LAUNDRY':
      // PRD.md §12: "Woshman keyword: LAUNDRY | customer ✅ | COO ❌ | Woshman ❌ | Partner ❌"
      await sendMessage({ to: order.user.phoneNumber, body: STATUS_UPDATE_MESSAGES.at_laundry });
      return;

    case 'READY_FOR_DELIVERY':
      // PRD.md §12: "Partner keyword: READY | customer ❌ | COO ❌ | Woshman ✅ alert | Partner ❌"
      if (!order.woshman) {
        logger.error(
          { orderId, orderNumber: order.orderNumber },
          'READY_FOR_DELIVERY notification: no Woshman assigned to alert — cannot notify',
        );
        return;
      }
      await sendMessage({ to: order.woshman.phoneNumber, body: readyForPickupAlertMessage(order.orderNumber) });
      return;

    case 'OUT_FOR_DELIVERY': {
      // PRD.md §12: "Woshman keyword: DELIVERING | customer ✅ | COO ❌ | Woshman ❌ | Partner ❌"
      const woshmanName = order.woshman?.name ?? 'Your Woshman';
      await sendMessage({ to: order.user.phoneNumber, body: outForDeliveryMessage(woshmanName) });
      return;
    }

    case 'DELIVERED':
      // PRD.md §12: "Woshman keyword: DELIVERED | customer ✅ + feedback prompt | COO ✅ | Woshman ❌ | Partner ❌"
      await sendMessage({ to: order.user.phoneNumber, body: STATUS_UPDATE_MESSAGES.delivered });
      await sendMessage({ to: order.user.phoneNumber, body: FEEDBACK_PROMPT_MESSAGE });
      // No COO dashboard/WhatsApp channel exists yet (Phase 5 Admin API) — informational
      // logging is the interim equivalent, matching CLAUDE.md's alerting philosophy
      // ("everything else surfaces in Retool/logs for business-hours review").
      logger.info({ orderId, orderNumber: order.orderNumber }, 'Order delivered — COO notified (log)');
      return;

    case 'ASSIGNED':
      // PRD.md §12 "Bank transfer verified (PAID)" / "COD order confirmed" rows: customer
      // ✅, Woshman ✅ dispatch brief, partner ✅ job brief. Per USER_JOURNEY.md §2/§3 these
      // only make sense once a Woshman/partner is actually chosen, so this fires from the
      // Admin API's assign action (docs/BUILD_SCRIPT.md Phase 5), not from PAID itself —
      // confirmed as the correct reading during Phase 5 build (PRD's PAID row predates
      // assignment being modeled as its own later COO action).
      if (!order.woshman || !order.partner) {
        logger.error(
          { orderId, orderNumber: order.orderNumber },
          'ASSIGNED notification: order missing woshman or partner — cannot notify',
        );
        return;
      }
      await sendMessage({ to: order.user.phoneNumber, body: dispatchConfirmationMessage(order.woshman.name) });
      await sendMessage({
        to: order.woshman.phoneNumber,
        body: woshmanDispatchBriefMessage({
          orderNumber: order.orderNumber,
          address: order.address,
          landmark: order.landmark,
          zone: order.zone,
          pickupWindow: order.pickupWindow,
        }),
      });
      await sendMessage({
        to: order.partner.phoneNumber,
        body: partnerJobBriefMessage({
          orderNumber: order.orderNumber,
          serviceType: order.serviceType,
          itemsDescription: order.itemsDescription,
        }),
      });
      return;

    case 'PAYMENT_WINDOW_ABANDONED':
      // PRD.md §11.2/§12: the 60-min payment-window timeout gets a customer message
      // AND a COO notification — unlike the 30-min quote-timeout, which PRD.md §11.2
      // explicitly says gets no COO notification at all (handled outside notify(),
      // see sessionTimeout.job.ts, since no order exists yet at that stage). No real
      // COO WhatsApp channel exists yet — informational logging is the interim
      // equivalent, matching the same precedent as DELIVERED above.
      await sendMessage({ to: order.user.phoneNumber, body: PAYMENT_WINDOW_ABANDONED_MESSAGE });
      logger.info({ orderId, orderNumber: order.orderNumber }, 'Order abandoned after payment-window timeout — COO notified (log)');
      return;
  }
}

// docs/TRD.md §5.2 POST /admin/messages/send — "manual one-off customer message". Not
// one of the event-driven rows in PRD.md §12's matrix, but still must route through this
// service and not call the Messaging Service (or Twilio) directly, per CLAUDE.md rule 5.
export async function sendManualMessage(to: string, body: string): Promise<void> {
  await sendMessage({ to, body });
}
