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
import { FEEDBACK_PROMPT_MESSAGE, outForDeliveryMessage, readyForPickupAlertMessage, STATUS_UPDATE_MESSAGES } from '../../conversation/messages';
import { logger } from '../../lib/logger';
import { sendMessage } from '../../messaging/send.service';
import { prisma } from '../../db/client';

export type NotificationEvent = 'PICKED_UP' | 'AT_LAUNDRY' | 'READY_FOR_DELIVERY' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

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
  }
}
