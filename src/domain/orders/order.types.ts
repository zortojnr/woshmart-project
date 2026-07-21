// Order domain types.

export type OrderStatus =
  | 'initiated'
  | 'awaiting_confirmation'
  | 'awaiting_payment'
  | 'paid'
  | 'assigned'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'at_laundry'
  | 'ready_for_delivery'
  | 'out_for_delivery'
  | 'delivered'
  | 'closed'
  | 'cancelled'
  | 'abandoned'
  | 'disputed';

// order_status_history.changed_by (docs/DATABASE_SCHEMA.md).
export type ChangedBy = 'system' | 'woshman' | 'partner' | `admin:${string}`;
