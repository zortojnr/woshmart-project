// Seeds one order for manually testing Retool screens without running a full WhatsApp
// conversation each time. Deliberately reuses the same domain functions the real
// conversation FSM and Admin API use (createOrderFromQuote, transitionOrderStatus) —
// this is not a second path that fabricates an orders row directly; it goes through
// order.statemachine.ts like everything else (CLAUDE.md rule 4).
//
//   npx tsx scripts/seed-test-order.ts [--phone=+2347...] [--bundle=starter] \
//     [--zone=Maitumbi] [--payment=transfer] [--address="..."] [--pickup=1] [--status=paid]
//
// All flags optional — see DEFAULTS below. --status accepts "awaiting_payment" (where a
// real conversation naturally lands after YES) or "paid" (one further transition, useful
// for testing the Retool assign flow without also clicking "Mark PAID" first). Anything
// past "paid" (e.g. "assigned") needs a Woshman + partner to assign, which is a Retool
// action itself, not something this script fabricates on its own.
//
// Needs the full .env, not just DATABASE_URL — transitionOrderStatus's logger import
// pulls in config/env.ts, which validates every required var (Twilio/JWT/bank), even
// though none of them are actually used by this script. To target staging's database
// while keeping your local dev .env's other values (fine, since nothing here calls
// Twilio), override just DATABASE_URL inline:
//   DATABASE_URL="<staging External Database URL>" npx tsx scripts/seed-test-order.ts
import { createOrderFromQuote } from '../src/domain/orders/order.service';
import { transitionOrderStatus } from '../src/domain/orders/order.statemachine';
import { prisma } from '../src/db/client';
import type { BundleId } from '../src/domain/pricing/bundles.config';
import { BUNDLES } from '../src/domain/pricing/bundles.config';
import { getPickupWindowByMenuReply } from '../src/domain/orders/pickupWindows.config';

const DEFAULTS = {
  phone: `+2347000${Date.now().toString().slice(-6)}`,
  bundle: 'starter' as BundleId,
  zone: 'Maitumbi',
  payment: 'transfer' as 'transfer' | 'cod',
  address: '1 Test Street, blue gate',
  pickup: '1',
  status: 'awaiting_payment' as 'awaiting_payment' | 'paid',
};

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!match) {
      console.error(`Unrecognized argument: "${arg}" (expected --name=value)`);
      process.exit(1);
    }
    const [, key, value] = match;
    flags[key!] = value!;
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  const phone = flags.phone ?? DEFAULTS.phone;
  const bundle = (flags.bundle ?? DEFAULTS.bundle) as BundleId;
  const zone = flags.zone ?? DEFAULTS.zone;
  const payment = (flags.payment ?? DEFAULTS.payment) as 'transfer' | 'cod';
  const address = flags.address ?? DEFAULTS.address;
  const pickupReply = flags.pickup ?? DEFAULTS.pickup;
  const targetStatus = (flags.status ?? DEFAULTS.status) as 'awaiting_payment' | 'paid';

  if (!BUNDLES[bundle]) {
    console.error(`Unknown bundle "${bundle}". Valid options: ${Object.keys(BUNDLES).join(', ')}`);
    process.exit(1);
  }
  if (payment !== 'transfer' && payment !== 'cod') {
    console.error(`Unknown payment method "${payment}". Valid options: transfer, cod`);
    process.exit(1);
  }
  if (targetStatus !== 'awaiting_payment' && targetStatus !== 'paid') {
    console.error(`Unsupported --status "${targetStatus}". Valid options: awaiting_payment, paid`);
    process.exit(1);
  }
  const pickupWindow = getPickupWindowByMenuReply(pickupReply);
  if (!pickupWindow) {
    console.error(`Unknown --pickup "${pickupReply}". Valid options: 1, 2, 3, 4, 5 (see PICKUP_TIME_MESSAGE)`);
    process.exit(1);
  }

  let order = await createOrderFromQuote({
    phoneNumber: phone,
    zone,
    address,
    bundleId: bundle,
    pickupWindow,
    paymentMethod: payment,
  });

  if (targetStatus === 'paid') {
    order = await transitionOrderStatus(order.id, 'paid', 'system', 'Seeded for Retool testing');
  }

  console.log(`Created order ${order.orderNumber} (id: ${order.id}) for ${phone}, status: ${order.status}.`);
}

main()
  .catch((err) => {
    console.error('Failed to seed test order:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
