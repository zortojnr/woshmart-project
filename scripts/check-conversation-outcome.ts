// Answers "what actually happened when this phone number's inbound message was
// processed?" for the customer conversation flow specifically (as opposed to
// check-keyword-webhook-outcome.ts, which is for the Woshman/partner keyword path and
// needs an order number). Checks the two tables that tell the real story directly:
// sessions (was a session ever created/advanced for this number?) and messages (was an
// outbound send attempted, and did it succeed or fail?) -- both more reliable than
// hunting through logs, since a caught-and-logged error here never reaches Sentry
// (only src/app.ts's global Express error handler calls Sentry.captureException, and
// the webhook controller's own try/catch swallows processing failures before they'd
// ever get there).
//
//   npx tsx scripts/check-conversation-outcome.ts --phone=+234... \
//     --from="2026-07-28T14:19:00Z" --to="2026-07-28T14:44:00Z"
//
// Standalone re: config, same reasoning as check-staging-db-deadline.ts /
// check-keyword-webhook-outcome.ts: only needs DATABASE_URL, doesn't pull in the full
// app env. Never prints the connection string.
//   DATABASE_URL="<staging External Database URL>" npx tsx scripts/check-conversation-outcome.ts ...
import { PrismaClient } from '@prisma/client';

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
  const { phone, from, to } = flags;

  if (!phone || !from || !to) {
    console.error('Usage: --phone=+234... --from=<ISO 8601> --to=<ISO 8601>');
    process.exit(1);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error('--from/--to must be valid ISO 8601 timestamps, e.g. 2026-07-28T14:19:00Z');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  try {
    console.log(`\n=== sessions row for ${phone} ===`);
    const session = await prisma.session.findUnique({
      where: { phoneNumber: phone },
      select: { id: true, state: true, context: true, lastMessageAt: true, createdAt: true, updatedAt: true },
    });
    if (!session) {
      console.log('None found. loadOrCreateSession (src/conversation/session.repository.ts) never ran for this number -- the ' +
        'failure is at or before session creation, e.g. the request never reached processInboundMessage at all.');
    } else {
      console.log(
        `id: ${session.id}\nstate: ${session.state}\ncontext: ${JSON.stringify(session.context)}\n` +
        `createdAt: ${session.createdAt.toISOString()}\nupdatedAt: ${session.updatedAt.toISOString()}\n` +
        `lastMessageAt: ${session.lastMessageAt.toISOString()}`,
      );
      console.log(
        session.state === 'WELCOME'
          ? 'State is still WELCOME -- either this is the session\'s first-ever load (upsert creates it at WELCOME ' +
            'before the handler runs), or the handler/save step never completed. Compare createdAt vs. updatedAt: ' +
            'equal timestamps mean saveSession never ran after creation.'
          : `State has advanced past WELCOME to ${session.state} -- the handler and saveSession both completed. ` +
            'If no outbound message arrived, the failure is in the send step specifically (see below).',
      );
    }

    console.log(`\n=== inbound messages from ${phone} between ${from} and ${to} ===`);
    const inbound = await prisma.message.findMany({
      where: { direction: 'inbound', phoneNumber: phone, createdAt: { gte: fromDate, lte: toDate } },
      orderBy: { createdAt: 'asc' },
      select: { body: true, status: true, twilioSid: true, createdAt: true },
    });
    if (inbound.length === 0) {
      console.log('None found. The webhook never reached this database in that window.');
    } else {
      for (const msg of inbound) {
        console.log(`[${msg.createdAt.toISOString()}] status: ${msg.status} -- twilioSid: ${msg.twilioSid ?? '(none)'}\n  body: ${msg.body}`);
      }
    }

    console.log(`\n=== outbound messages to ${phone} between ${from} and ${to} (plus 2 min after the window) ===`);
    const outboundWindowEnd = new Date(toDate.getTime() + 2 * 60 * 1000);
    const outbound = await prisma.message.findMany({
      where: { direction: 'outbound', phoneNumber: phone, createdAt: { gte: fromDate, lte: outboundWindowEnd } },
      orderBy: { createdAt: 'asc' },
      select: { body: true, status: true, twilioSid: true, createdAt: true },
    });
    if (outbound.length === 0) {
      console.log(
        'None found -- not even a "failed" row. This means sendMessage() (src/messaging/send.service.ts) was never ' +
        'called at all for this number in this window, which points at something failing before the final send loop ' +
        'in processInboundMessage -- most likely inside the WELCOME handler itself or saveSession, not a Twilio-side failure.',
      );
    } else {
      for (const msg of outbound) {
        console.log(`[${msg.createdAt.toISOString()}] status: ${msg.status} -- twilioSid: ${msg.twilioSid ?? '(none)'}\n  body: ${msg.body}`);
      }
      const anyFailed = outbound.some((m) => m.status === 'failed');
      if (anyFailed) {
        console.log(
          '\nAt least one outbound row has status "failed" with no twilioSid -- sendMessage() was called and Twilio ' +
          'rejected it after all retries. Check TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_NUMBER on the ' +
          'staging Web Service, and whether this recipient number is actually joined to the Twilio sandbox (if using ' +
          'the sandbox), which is a common permanent-failure cause here.',
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error('Failed to check conversation outcome:', err.message);
  process.exitCode = 1;
});
