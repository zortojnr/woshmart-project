// Temporarily changes a Woshman's registered phone number -- e.g. to free up your own
// test number for a customer-flow test without losing the Woshman row (name,
// availability, stats, history). The alternative to deleting/recreating test records,
// and the actual working substitute for "deactivate" -- setting `active: false` does
// NOT remove a Woshman from keyword-routing (findWoshmanByPhone does an unconditional
// phone lookup with no active filter; see docs/BUILD_LOG.md's Post-MVP log). Run this
// again with --from/--to reversed afterward to swap back.
//
//   npx tsx scripts/swap-woshman-phone.ts --from=+234... --to=+234...
//
// Needs only DATABASE_URL (imports woshman.service.ts -> db/client.ts directly, not
// config/env.ts, so no other env vars are required) -- safe to point at staging:
//   DATABASE_URL="<staging External Database URL>" npx tsx scripts/swap-woshman-phone.ts --from=... --to=...
import { findWoshmanByPhone, updateWoshman } from '../src/domain/woshmen/woshman.service';
import { prisma } from '../src/db/client';

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
  const { from, to } = flags;

  if (!from || !to) {
    console.error('Usage: --from=<current phone number> --to=<new phone number>');
    process.exit(1);
  }

  const woshman = await findWoshmanByPhone(from);
  if (!woshman) {
    console.error(`No Woshman found with phone number "${from}".`);
    process.exit(1);
  }
  console.log(
    `Before: "${woshman.name}" (id: ${woshman.id}) — phone: ${woshman.phoneNumber}, availability: ${woshman.availability}, active: ${woshman.active}.`,
  );

  const existingAtTarget = await findWoshmanByPhone(to);
  if (existingAtTarget) {
    console.error(`A Woshman already exists with phone number "${to}" (id: ${existingAtTarget.id}). Refusing to overwrite.`);
    process.exit(1);
  }

  const updated = await updateWoshman(woshman.id, { phoneNumber: to });
  console.log(`After:  "${updated.name}" (id: ${updated.id}) — phone: ${updated.phoneNumber}.`);
  console.log(`To swap back later: npx tsx scripts/swap-woshman-phone.ts --from=${to} --to=${from}`);
}

main()
  .catch((err) => {
    console.error('Failed to swap Woshman phone number:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
