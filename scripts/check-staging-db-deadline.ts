// Reminds someone, loudly and repeatedly, before woshmart-staging-db's Render
// free-tier hard-deletion deadline (docs/SECURITY.md §3.9). Run daily by
// .github/workflows/staging-backup.yml.
//
// Deliberately standalone — does NOT import src/config/env.ts or
// src/lib/alertEmail.ts. Both are coupled to the full application env schema
// (TWILIO_*, DATABASE_URL, JWT_SIGNING_SECRET, ...), which this script has no
// business requiring just to send one reminder email in a CI job that only has the
// ALERT_SMTP_*/ALERT_EMAIL_TO secrets available. Uses the same library (nodemailer)
// and the same alert-email shape as src/lib/alertEmail.ts, just without that
// cross-cutting dependency.
import nodemailer from 'nodemailer';

// Update this the day a fresh free-tier Postgres instance replaces this one — this
// script has no way to detect that on its own.
const STAGING_DB_CREATED_AT = '2026-07-24';

const EXPIRATION_DAYS = 30;
const GRACE_PERIOD_DAYS = 14;
const TOTAL_LIFESPAN_DAYS = EXPIRATION_DAYS + GRACE_PERIOD_DAYS;
const REMINDER_STARTS_AT_DAY = 30;

function daysSince(dateStr: string): number {
  const created = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
}

async function main(): Promise<void> {
  const daysElapsed = daysSince(STAGING_DB_CREATED_AT);
  const daysRemaining = TOTAL_LIFESPAN_DAYS - daysElapsed;

  console.log(`woshmart-staging-db: ${daysElapsed} day(s) since creation, ${daysRemaining} day(s) until permanent deletion.`);

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
    `woshmart-staging-db (Render free-tier Postgres) was created on ${STAGING_DB_CREATED_AT}.`,
    `Free-tier databases expire ${EXPIRATION_DAYS} days after creation, with a ${GRACE_PERIOD_DAYS}-day grace period to upgrade before Render permanently deletes the database and all its data.`,
    '',
    `Days elapsed: ${daysElapsed}`,
    `Days remaining before permanent deletion: ${daysRemaining}`,
    '',
    'Action needed: either upgrade woshmart-staging-db to a paid instance type in the Render dashboard, or follow the recreate-and-restore procedure in docs/SECURITY.md §3.9 using the latest daily backup from Backblaze B2.',
    'Once resolved, update STAGING_DB_CREATED_AT in scripts/check-staging-db-deadline.ts to the new instance\'s actual creation date — this script has no way to detect the change on its own.',
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

main().catch((err: Error) => {
  console.error('Failed to run the staging DB deadline check:', err.message);
  process.exitCode = 1;
});
