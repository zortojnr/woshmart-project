import type { Response } from 'express';
import { z } from 'zod';
import { assignOrder } from '../../domain/orders/order.service';
import { getOrderDetail, listOrders } from '../../domain/orders/order.repository';
import { IllegalOrderTransitionError, transitionOrderStatus } from '../../domain/orders/order.statemachine';
import { notify } from '../../domain/notifications/notification.service';
import type { OrderStatus } from '../../domain/orders/order.types';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

const ORDER_STATUSES: OrderStatus[] = [
  'initiated',
  'awaiting_confirmation',
  'awaiting_payment',
  'paid',
  'assigned',
  'pickup_scheduled',
  'picked_up',
  'at_laundry',
  'ready_for_delivery',
  'out_for_delivery',
  'delivered',
  'closed',
  'cancelled',
  'abandoned',
  'disputed',
];

const listQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]).optional(),
  zone: z.string().optional(),
  woshmanId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
});

// GET /admin/orders — list/filter orders.
export async function list(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new BadRequestError('Invalid filter parameters');
  }

  const orders = await listOrders(parsed.data);
  res.status(200).json({ orders });
}

// GET /admin/orders/:id — order detail + status history.
export async function detail(req: AuthenticatedRequest, res: Response): Promise<void> {
  const order = await getOrderDetail(req.params.id as string);
  if (!order) {
    throw new NotFoundError('Order not found');
  }
  res.status(200).json({ order });
}

const statusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]),
  note: z.string().optional(),
});

// PATCH /admin/orders/:id/status — manual status transition, validated through the same
// order.statemachine.ts used by the conversation engine and keyword parser (no fourth
// path that can set orders.status directly, per docs/BUILD_SCRIPT.md Phase 5 item 5).
export async function updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = statusUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('status is required and must be a valid order status');
  }

  const orderId = req.params.id as string;
  const before = await getOrderDetail(orderId);
  if (!before) {
    throw new NotFoundError('Order not found');
  }

  let updated;
  try {
    updated = await transitionOrderStatus(orderId, parsed.data.status, `admin:${req.admin!.id}`, parsed.data.note);
  } catch (err) {
    if (err instanceof IllegalOrderTransitionError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  }

  await recordAudit(req, res, {
    action: 'order.status.update',
    entityType: 'order',
    entityId: orderId,
    before: { status: before.status },
    after: { status: updated.status },
  });
  res.status(200).json({ order: updated });
}

const assignSchema = z.object({
  woshmanId: z.string().uuid(),
  partnerId: z.string().uuid(),
});

// PATCH /admin/orders/:id/assign — assign Woshman + partner.
export async function assign(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('woshmanId and partnerId are required');
  }

  const orderId = req.params.id as string;
  const before = await getOrderDetail(orderId);
  if (!before) {
    throw new NotFoundError('Order not found');
  }

  let updated;
  try {
    updated = await assignOrder(orderId, parsed.data, `admin:${req.admin!.id}`);
  } catch (err) {
    if (err instanceof IllegalOrderTransitionError) {
      throw new BadRequestError(err.message);
    }
    throw err;
  }

  await recordAudit(req, res, {
    action: 'order.assign',
    entityType: 'order',
    entityId: orderId,
    before: { status: before.status, woshmanId: before.woshmanId, partnerId: before.partnerId },
    after: { status: updated.status, woshmanId: updated.woshmanId, partnerId: updated.partnerId },
  });

  // The assignment write already succeeded — a notification failure (Twilio down, etc.)
  // must not turn a successful assign into an error response. Logged and surfaced for
  // business-hours review, per CLAUDE.md's alerting philosophy, not retried inline here.
  try {
    await notify('ASSIGNED', orderId);
  } catch (err) {
    logger.error({ err: (err as Error).message, orderId }, 'ASSIGNED notification failed after successful order assignment');
  }

  res.status(200).json({ order: updated });
}
