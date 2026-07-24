// Reminds someone, loudly and repeatedly, before woshmart-staging-db's Render
// free-tier hard-deletion deadline (docs/SECURITY.md §3.9). Run daily by
// .github/workflows/staging-backup.yml.
//
// Deliberately standalone re: alert-email config — does NOT import
// src/config/env.ts or src/lib/alertEmail.ts. Both are coupled to the full
// application env schema (TWILIO_*, JWT_SIGNING_SECRET, ...), which this script has
// no business requiring just to send one reminder email in a CI job that only has
// ALERT_SMTP_*/ALERT_EMAIL_TO/STAGING_DATABASE_URL available. Uses the same library
// (nodemailer) and the same alert-email shape as src/lib/alertEmail.ts, just without
// that cross-cutting dependency.
//
// The "creation date" is read from the database itself, not a hardcoded constant —
// Postgres has no genuine "database created at" anywhere in its system catalogs
// (checked directly: neither pg_database nor pg_stat_database expose one), so this
// uses the earliest _prisma_migrations.started_at as a proxy. That row gets written
// automatically the moment `prisma migrate deploy` first runs against a database —
// which is already step 3 of the recreate-and-restore procedure — so this is
// self-correcting after a recreation with zero extra manual step, unlike a hardcoded
// date or a custom one-row table someone has to remember to update.
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

const EXPIRATION_DAYS = 30;
const GRACE_PERIOD_DAYS = 14;
const TOTAL_LIFESPAN_DAYS = EXPIRATION_DAYS + GRACE_PERIOD_DAYS;
// Migrations run slightly AFTER the database is actually created, so the proxy
// timestamp always understates true elapsed time by some small margin (minutes to
// hours in practice). Starting 2 days earlier than the nominal 30-day expiration
// absorbs that in the safe direction, rather than risking a late-arriving first
// reminder.
const REMINDER_STARTS_AT_DAY = 28;

// Exported for tests — this is the one function whose failure mode (crash vs. clear
// error vs. silently wrong date) actually matters, since it's what the whole
// self-updating mechanism depends on.
export async function getEffectiveCreatedAt(databaseUrl: string): Promise<Date> {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const rows = await prisma.$queryRaw<{ created_at: Date | null }[]>`
      SELECT MIN(started_at) AS created_at FROM _prisma_migrations
    `;
    // MIN() over zero rows returns exactly one row shaped { created_at: null }, not
    // zero rows — confirmed against a real empty table, not assumed. `rows[0]?.` is
    // still there as a defensive fallback in case a driver ever behaves differently.
    const createdAt = rows[0]?.created_at;
    if (!createdAt) {
      throw new Error('_prisma_migrations has no rows — has `prisma migrate deploy` ever run against this database?');
    }
    return createdAt;
  } finally {
    await prisma.$disconnect();
  }
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export async function main(): Promise<void> {
  const { STAGING_DATABASE_URL } = process.env;
  if (!STAGING_DATABASE_URL) {
    console.error('STAGING_DATABASE_URL is not set — cannot determine the database\'s actual creation date.');
    process.exitCode = 1;
    return;
  }

  const createdAt = await getEffectiveCreatedAt(STAGING_DATABASE_URL);
  const daysElapsed = daysBetween(createdAt, new Date());
  const daysRemaining = TOTAL_LIFESPAN_DAYS - daysElapsed;

  console.log(
    `woshmart-staging-db: earliest migration applied ${createdAt.toISOString()} (used as the effective creation date). ${daysElapsed} day(s) elapsed, ${daysRemaining} day(s) until permanent deletion.`,
  );

  if (daysElapsed < REMINDER_STARTS_AT_DAY) {
    console.log('Within the safe window — no reminder needed.');
    return;
  }

  const { ALERT_SMTP_HOST, ALERT_SMTP_PORT, ALERT_SMTP_USER, ALERT_SMTP_PASSWORD, ALERT_EMAIL_TO } = process.env;
  if (!ALERT_SMTP_HOST || !ALERT_SMTP_PORT || !ALERT_SMTP_USER || !ALERT_SMTP_PASSWORD || !ALERT_EMAIL_TO) {
    console.error(`ALERT_SMTP_*/ALERT_EMAIL_TO not fully configured as GitHub Actions secrets — cannot send the deadline reminder, and there are only ${daysRemaining} day(s) left. Fix this now.`);
    process.exitCode = 1;
    return;
  }

  const urgency = daysRemaining <= 3 ? '🚨 FINAL WARNING' : daysRemaining <= 7 ? '⚠️ URGENT' : '⚠️';
  const subject = `[Woshmart URGENT] ${urgency} — woshmart-staging-db: ${daysRemaining} day(s) until permanent deletion`;
  const body = [
    `woshmart-staging-db (Render free-tier Postgres) was effectively created ${createdAt.toISOString()} (earliest _prisma_migrations run — Postgres has no queryable true creation timestamp).`,
    `Free-tier databases expire ${EXPIRATION_DAYS} days after creation, with a ${GRACE_PERIOD_DAYS}-day grace period to upgrade before Render permanently deletes the database and all its data.`,
    '',
    `Days elapsed: ${daysElapsed}`,
    `Days remaining before permanent deletion: ${daysRemaining}`,
    '',
    'Action needed: either upgrade woshmart-staging-db to a paid instance type in the Render dashboard, or follow the recreate-and-restore procedure in docs/SECURITY.md §3.9 using the latest daily backup from Backblaze B2.',
    'No manual bookkeeping needed after a restore — this reminder reads the new database\'s own earliest migration timestamp automatically once `prisma migrate deploy` has run against it.',
  ].join('\n');

  const transport = nodemailer.createTransport({
    host: ALERT_SMTP_HOST,
    port: Number(ALERT_SMTP_PORT),
    secure: Number(ALERT_SMTP_PORT) === 465,
    auth: { user: ALERT_SMTP_USER, pass: ALERT_SMTP_PASSWORD },
  });

  await transport.sendMail({ from: ALERT_SMTP_USER, to: ALERT_EMAIL_TO, subject, text: body });
  console.log('Deadline reminder email sent.');
}

// Guarded so importing this module in a test doesn't also execute it — only runs
// when this file is the process's actual entry point (`tsx scripts/check-staging-db-deadline.ts`).
if (require.main === module) {
  main().catch((err: Error) => {
    console.error('Failed to run the staging DB deadline check:', err.message);
    process.exitCode = 1;
  });
}
