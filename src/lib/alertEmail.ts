// Urgent-alert email (docs/BUILD_SCRIPT.md Phase 7 item 8). Deliberately narrow: this
// exists ONLY for the one category CLAUDE.md's alerting philosophy calls out as
// deserving a real page — payment/data-integrity issues — not as a general alerting
// platform. Everything else (individual send failures, single slow jobs, ordinary
// retries) stays in logs/Retool for business-hours review, per that same philosophy.
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

function isConfigured(): boolean {
  return Boolean(env.ALERT_SMTP_HOST && env.ALERT_SMTP_PORT && env.ALERT_SMTP_USER && env.ALERT_SMTP_PASSWORD && env.ALERT_EMAIL_TO);
}

// A failure to send THIS email must not throw — it's already being called from a
// dead-letter path that has nothing further to escalate to. Logged loudly either way,
// since the underlying dead-letter log line remains the record of truth regardless of
// whether the email made it out.
export async function sendUrgentAlertEmail(subject: string, body: string): Promise<void> {
  if (!isConfigured()) {
    logger.warn({ subject }, 'Urgent alert email not sent — ALERT_SMTP_* / ALERT_EMAIL_TO not configured');
    return;
  }

  try {
    const transport = nodemailer.createTransport({
      host: env.ALERT_SMTP_HOST,
      port: env.ALERT_SMTP_PORT,
      secure: env.ALERT_SMTP_PORT === 465,
      auth: { user: env.ALERT_SMTP_USER, pass: env.ALERT_SMTP_PASSWORD },
    });

    await transport.sendMail({
      from: env.ALERT_SMTP_USER,
      to: env.ALERT_EMAIL_TO,
      subject: `[Woshmart URGENT] ${subject}`,
      text: body,
    });

    logger.info({ subject }, 'Urgent alert email sent');
  } catch (err) {
    logger.error({ err: (err as Error).message, subject }, 'Failed to send urgent alert email');
  }
}
