-- Enum-like TEXT columns don't have a native Prisma schema representation for
-- Postgres CHECK constraints in this Prisma version, so they're added here directly
-- to match docs/DATABASE_SCHEMA.md / docs/TRD.md §6 exactly — the DB itself should
-- reject an invalid enum value, not just the application layer.

ALTER TABLE "users"
  ADD CONSTRAINT "users_account_status_check"
  CHECK ("account_status" IN ('active', 'flagged', 'blocked'));

ALTER TABLE "woshmen"
  ADD CONSTRAINT "woshmen_availability_check"
  CHECK ("availability" IN ('available', 'on_job', 'off_duty'));

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_status_check"
  CHECK ("status" IN ('active', 'warning', 'suspended'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_payment_method_check"
  CHECK ("payment_method" IN ('transfer', 'cod'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_payment_status_check"
  CHECK ("payment_status" IN ('pending', 'confirmed', 'refunded'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN (
    'initiated', 'awaiting_confirmation', 'awaiting_payment', 'paid',
    'assigned', 'pickup_scheduled', 'picked_up', 'at_laundry',
    'ready_for_delivery', 'out_for_delivery', 'delivered',
    'closed', 'cancelled', 'abandoned', 'disputed'
  ));

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_direction_check"
  CHECK ("direction" IN ('inbound', 'outbound'));

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_score_check"
  CHECK ("score" BETWEEN 1 AND 3);

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_resolved_check"
  CHECK ("resolved" IN ('yes', 'no', 'n/a'));

ALTER TABLE "admins"
  ADD CONSTRAINT "admins_role_check"
  CHECK ("role" IN ('super_admin', 'ops', 'viewer'));
