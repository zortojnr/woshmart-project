// Seeds one test Woshman and/or one test partner laundry — mainly so the Assign
// dropdowns in Retool have real options to pick from without waiting on real Woshman/
// partner onboarding. There's no domain "create" function to reuse for either table
// (woshman.service.ts / partner.service.ts only have find/list/update — same situation
// scripts/seed-super-admin.ts is in for the admins table), so this creates rows directly
// via Prisma, same precedent as that script.
//
//   npx tsx scripts/seed-test-woshman-partner.ts [--only=woshman|partner] \
//     [--woshman-name="..."] [--woshman-phone=+2347...] [--woshman-availability=available] \
//     [--partner-name="..."] [--partner-phone=+2347...] [--partner-address="..."] \
//     [--partner-starch=true] [--partner-express=true]
//
// All flags optional. Defaults create both a Woshman and a partner with generated
// phone numbers. Needs only DATABASE_URL (this file doesn't touch config/env.ts at
// all — no logger/order-service imports here) — safe to point at staging the same way
// as scripts/seed-super-admin.ts:
//   DATABASE_URL="<staging External Database URL>" npx tsx scripts/seed-test-woshman-partner.ts
import { prisma } from '../src/db/client';

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) {
      console.error(`Unrecognized argument: "${arg}" (expected --name=value)`);
      process.exit(1);
    }
    const [, key, value] = match;
    flags[key!] = value!;
  }
  return flags;
}

async function seedWoshman(flags: Record<string, string>): Promise<void> {
  const name = flags['woshman-name'] ?? 'Test Woshman';
  const phoneNumber = flags['woshman-phone'] ?? `+2347100${Date.now().toString().slice(-6)}`;
  const availability = flags['woshman-availability'] ?? 'available';

  if (availability !== 'available' && availability !== 'on_job' && availability !== 'off_duty') {
    console.error(`Unknown --woshman-availability "${availability}". Valid options: available, on_job, off_duty`);
    process.exit(1);
  }

  const existing = await prisma.woshman.findUnique({ where: { phoneNumber } });
  if (existing) {
    console.error(`A Woshman with phone "${phoneNumber}" already exists (id: ${existing.id}). Not overwriting.`);
    process.exit(1);
  }

  const woshman = await prisma.woshman.create({ data: { name, phoneNumber, availability } });
  console.log(`Created Woshman "${woshman.name}" (id: ${woshman.id}, phone: ${woshman.phoneNumber}, availability: ${woshman.availability}).`);
}

async function seedPartner(flags: Record<string, string>): Promise<void> {
  const name = flags['partner-name'] ?? 'Test Partner Laundry';
  const phoneNumber = flags['partner-phone'] ?? `+2347200${Date.now().toString().slice(-6)}`;
  const address = flags['partner-address'] ?? '1 Test Laundry Road';
  const canDoStarch = flags['partner-starch'] === 'true';
  const canDoExpress = flags['partner-express'] === 'true';

  const existing = await prisma.partner.findUnique({ where: { phoneNumber } });
  if (existing) {
    console.error(`A partner with phone "${phoneNumber}" already exists (id: ${existing.id}). Not overwriting.`);
    process.exit(1);
  }

  const partner = await prisma.partner.create({
    data: { name, phoneNumber, address, canDoStarch, canDoExpress },
  });
  console.log(`Created partner "${partner.name}" (id: ${partner.id}, phone: ${partner.phoneNumber}, status: ${partner.status}).`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const only = flags.only;

  if (only !== undefined && only !== 'woshman' && only !== 'partner') {
    console.error(`Unknown --only "${only}". Valid options: woshman, partner (omit for both)`);
    process.exit(1);
  }

  if (only !== 'partner') {
    await seedWoshman(flags);
  }
  if (only !== 'woshman') {
    await seedPartner(flags);
  }
}

main()
  .catch((err) => {
    console.error('Failed to seed test Woshman/partner:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
