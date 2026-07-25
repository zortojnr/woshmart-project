// Answers "did this Woshman/partner keyword webhook actually arrive, and what happened
// when it was processed?" without requiring Retool access or app-server log access —
// reads directly from the same three tables the webhook itself writes to
// (messages, orders, order_status_history). Standalone re: config, same reasoning as
// check-staging-db-deadline.ts: only needs DATABASE_URL, so it does NOT import
// src/config/env.ts (which would demand the full TWILIO_*/JWT_SIGNING_SECRET/bank env
// just to run one read-only query) or src/db/client.ts (same reason) — talks to Prisma
// directly instead.
//
//   npx tsx scripts/check-keyword-webhook-outcome.ts --order=WM-003 --match="COLLECTED WM-003" \
//     --from="2026-07-25T15:41:00Z" --to="2026-07-25T15:43:00Z"
//
// --order   required — order number, used to also pull order_status_history context.
// --match   required — case-insensitive substring to search for in the inbound
//           message's body (e.g. the exact keyword command sent).
// --from    required — ISO 8601 start of the search window.
// --to      required — ISO 8601 end of the search window.
//
// Reasoning behind what counts as "the outcome": per keywordProtocol.service.ts, a
// SUCCESSFUL keyword transition sends nothing back to the Woshman/partner (only the
// customer gets notified) — so "no outbound reply found" is itself a meaningful,
// expected result, not a gap. Every failure path (malformed command, wrong sender,
// unknown order, no-op/already-at-status, illegal transition) DOES send a reply to the
// same phone number, so any outbound message to that number shortly after the inbound
// one is the concrete "why it didn't apply" answer. order_status_history is the
// independent, third-party confirmation of whether the transition actually landed,
// so this script always shows both rather than inferring one from the other.
//
// Prints only message content/timestamps/status fields — never DATABASE_URL or any
// other connection detail, per CLAUDE.md rule 11.
//   DATABASE_URL="<staging External Database URL>" npx tsx scripts/check-keyword-webhook-outcome.ts ...
import { PrismaClient } from '@prisma/client';

const REPLY_WINDOW_MS = 2 * 60 * 1000; // outbound replies land within seconds in practice; 2 min is a generous ceiling

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
  const { order: orderNumber, match, from, to } = flags;

  if (!orderNumber || !match || !from || !to) {
    console.error('Usage: --order=WM-003 --match="COLLECTED WM-003" --from=<ISO 8601> --to=<ISO 8601>');
    process.exit(1);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error('--from/--to must be valid ISO 8601 timestamps, e.g. 2026-07-25T15:41:00Z');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  try {
    const inboundMatches = await prisma.message.findMany({
      where: {
        direction: 'inbound',
        body: { contains: match, mode: 'insensitive' },
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, twilioSid: true, phoneNumber: true, body: true, status: true, createdAt: true },
    });

    console.log(`\n=== Inbound messages matching "${match}" between ${from} and ${to} ===`);
    if (inboundMatches.length === 0) {
      console.log('None found. The webhook never reached this database in that window — either it was never sent, ' +
        'never arrived at the server, or arrived outside this time range.');
    } else {
      for (const msg of inboundMatches) {
        console.log(
          `[${msg.createdAt.toISOString()}] from ${msg.phoneNumber} — status: ${msg.status} — twilioSid: ${msg.twilioSid ?? '(none)'}\n  body: ${msg.body}`,
        );
      }
    }

    for (const inbound of inboundMatches) {
      const replyWindowEnd = new Date(inbound.createdAt.getTime() + REPLY_WINDOW_MS);
      const replies = await prisma.message.findMany({
        where: {
          direction: 'outbound',
          phoneNumber: inbound.phoneNumber,
          createdAt: { gte: inbound.createdAt, lte: replyWindowEnd },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, body: true, status: true },
      });

      console.log(`\n--- Outbound replies to ${inbound.phoneNumber} within 2 min after ${inbound.createdAt.toISOString()} ---`);
      if (replies.length === 0) {
        console.log(
          'None found. Per keywordProtocol.service.ts, a SUCCESSFUL transition sends nothing back to the ' +
          'sender (only the customer is notified) — so this is consistent with the keyword having succeeded, ' +
          'not with it being dropped. Cross-check the order_status_history below to confirm.',
        );
      } else {
        for (const reply of replies) {
          console.log(`[${reply.createdAt.toISOString()}] status: ${reply.status}\n  body: ${reply.body}`);
        }
      }
    }

    const order = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true, status: true } });
    if (!order) {
      console.log(`\n=== order_status_history for ${orderNumber} ===\nNo order found with that number.`);
      return;
    }

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
      select: { fromStatus: true, toStatus: true, changedBy: true, note: true, createdAt: true },
    });

    console.log(`\n=== order_status_history for ${orderNumber} (current status: ${order.status}) ===`);
    for (const row of history) {
      console.log(
        `[${row.createdAt.toISOString()}] ${row.fromStatus ?? '(initial)'} -> ${row.toStatus} — changed_by: ${row.changedBy}${row.note ? ` — note: ${row.note}` : ''}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error('Failed to check keyword webhook outcome:', err.message);
  process.exitCode = 1;
});
