// Companion to seed-test-woshman-partner.ts — deletes a test Woshman and/or partner by
// phone number so they can be reseeded fresh later. There's no DELETE route for either
// in the Admin API (only GET/PATCH per docs/TRD.md §5.2), so this goes direct via
// Prisma, same precedent as the seed script.
//
//   npx tsx scripts/delete-test-woshman-partner.ts [--woshman-phone=+234...] [--partner-phone=+234...] [--force]
//
// At least one of the two phone flags is required. Safe to run against a phone number
// that doesn't exist (reports "not found", not an error).
//
// orders.woshman_id / orders.partner_id are ON DELETE SET NULL, not RESTRICT (confirmed
// against prisma/migrations/20260720151945_init/migration.sql, not assumed) — deleting a
// Woshman/partner still referenced by a real order does NOT fail, it silently nulls out
// that order's assignment while leaving its status untouched (e.g. an `assigned` order
// left with no Woshman). Refuses to delete a record with any referencing orders unless
// --force is passed, and reports exactly which orders would be affected either way.
import { prisma } from '../src/db/client';

function parseFlags(argv: string[]): { woshmanPhone?: string | undefined; partnerPhone?: string | undefined; force: boolean } {
  let woshmanPhone: string | undefined;
  let partnerPhone: string | undefined;
  let force = false;

  for (const arg of argv) {
    if (arg === '--force') {
      force = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) {
      console.error(`Unrecognized argument: "${arg}" (expected --name=value or --force)`);
      process.exit(1);
    }
    const [, key, value] = match;
    if (key === 'woshman-phone') woshmanPhone = value;
    else if (key === 'partner-phone') partnerPhone = value;
    else {
      console.error(`Unrecognized flag: "--${key}"`);
      process.exit(1);
    }
  }
  return { woshmanPhone, partnerPhone, force };
}

async function deleteWoshman(phoneNumber: string, force: boolean): Promise<void> {
  const woshman = await prisma.woshman.findUnique({ where: { phoneNumber } });
  if (!woshman) {
    console.log(`No Woshman with phone "${phoneNumber}" — nothing to delete.`);
    return;
  }

  const referencingOrders = await prisma.order.findMany({
    where: { woshmanId: woshman.id },
    select: { orderNumber: true, status: true },
  });

  if (referencingOrders.length > 0 && !force) {
    console.error(
      `Refusing to delete Woshman "${woshman.name}" (id: ${woshman.id}) — ${referencingOrders.length} order(s) still reference it: ` +
        `${referencingOrders.map((o) => `${o.orderNumber} [${o.status}]`).join(', ')}. Deleting would silently null out ` +
        `their woshman_id (the FK is ON DELETE SET NULL, not a hard block) without touching order status. Pass --force to proceed anyway.`,
    );
    return;
  }

  await prisma.woshman.delete({ where: { id: woshman.id } });
  const affectedNote = referencingOrders.length > 0 ? ` (${referencingOrders.length} order(s) now have woshman_id: null)` : '';
  console.log(`Deleted Woshman "${woshman.name}" (id: ${woshman.id}, phone: ${phoneNumber})${affectedNote}.`);
}

async function deletePartner(phoneNumber: string, force: boolean): Promise<void> {
  const partner = await prisma.partner.findUnique({ where: { phoneNumber } });
  if (!partner) {
    console.log(`No partner with phone "${phoneNumber}" — nothing to delete.`);
    return;
  }

  const referencingOrders = await prisma.order.findMany({
    where: { partnerId: partner.id },
    select: { orderNumber: true, status: true },
  });

  if (referencingOrders.length > 0 && !force) {
    console.error(
      `Refusing to delete partner "${partner.name}" (id: ${partner.id}) — ${referencingOrders.length} order(s) still reference it: ` +
        `${referencingOrders.map((o) => `${o.orderNumber} [${o.status}]`).join(', ')}. Deleting would silently null out ` +
        `their partner_id (the FK is ON DELETE SET NULL, not a hard block) without touching order status. Pass --force to proceed anyway.`,
    );
    return;
  }

  await prisma.partner.delete({ where: { id: partner.id } });
  const affectedNote = referencingOrders.length > 0 ? ` (${referencingOrders.length} order(s) now have partner_id: null)` : '';
  console.log(`Deleted partner "${partner.name}" (id: ${partner.id}, phone: ${phoneNumber})${affectedNote}.`);
}

async function main() {
  const { woshmanPhone, partnerPhone, force } = parseFlags(process.argv.slice(2));

  if (!woshmanPhone && !partnerPhone) {
    console.error('Usage: npx tsx scripts/delete-test-woshman-partner.ts [--woshman-phone=+234...] [--partner-phone=+234...] [--force]');
    process.exit(1);
  }

  if (woshmanPhone) await deleteWoshman(woshmanPhone, force);
  if (partnerPhone) await deletePartner(partnerPhone, force);
}

main()
  .catch((err) => {
    console.error('Failed to delete test Woshman/partner:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
