import 'dotenv/config';
import { z } from 'zod';

// Every var here (except the object-storage group) is required to exist before Phase 1
// per docs/SETUP_GUIDE.md §4. Object storage is only required if receipt image storage
// is in scope (docs/SECURITY.md §3.6) — not decided yet, so it stays optional and, if
// partially set, fails validation rather than silently running half-configured.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
    PORT: z.coerce.number().int().positive().default(3000),

    TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID is required'),
    TWILIO_AUTH_TOKEN: z.string().min(1, 'TWILIO_AUTH_TOKEN is required'),
    TWILIO_WHATSAPP_NUMBER: z.string().min(1, 'TWILIO_WHATSAPP_NUMBER is required'),

    DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
    REDIS_URL: z.string().url('REDIS_URL must be a valid connection string'),

    JWT_SIGNING_SECRET: z
      .string()
      .min(32, 'JWT_SIGNING_SECRET must be at least 32 characters — long and random, not a phrase'),

    // Real business bank details for the "Bank transfer instructions" copy
    // (PRD.md §10) — required from Phase 3 onward, since that message can't be sent
    // without them.
    BANK_NAME: z.string().min(1, 'BANK_NAME is required'),
    BANK_ACCOUNT_NUMBER: z.string().min(1, 'BANK_ACCOUNT_NUMBER is required'),
    // Not wired into the code until Phase 7 (error tracking) — optional until then so
    // Phase 1 boot isn't blocked on an unrelated external service being provisioned.
    SENTRY_DSN: z.string().url('SENTRY_DSN must be a valid URL').optional(),

    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
    OBJECT_STORAGE_REGION: z.string().min(1).optional(),

    // Urgent-alert email (docs/BUILD_SCRIPT.md Phase 7 item 8) — fires only for
    // payment/data-integrity dead-letters, per CLAUDE.md's alerting philosophy.
    // Optional so boot isn't blocked before this is provisioned; all-or-none like
    // object storage above, since a partially-set SMTP config would silently fail to
    // send exactly the alert it exists to guarantee.
    ALERT_SMTP_HOST: z.string().min(1).optional(),
    ALERT_SMTP_PORT: z.coerce.number().int().positive().optional(),
    ALERT_SMTP_USER: z.string().min(1).optional(),
    ALERT_SMTP_PASSWORD: z.string().min(1).optional(),
    ALERT_EMAIL_TO: z.string().email('ALERT_EMAIL_TO must be a valid email address').optional(),
  })
  .superRefine((vars, ctx) => {
    const objectStorageKeys = [
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_REGION',
    ] as const;
    const present = objectStorageKeys.filter((key) => vars[key] !== undefined);
    if (present.length > 0 && present.length < objectStorageKeys.length) {
      const missing = objectStorageKeys.filter((key) => vars[key] === undefined);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Partial object storage config — set all of [${objectStorageKeys.join(', ')}] or none. Missing: ${missing.join(', ')}`,
        path: ['OBJECT_STORAGE_ACCESS_KEY_ID'],
      });
    }

    const alertEmailKeys = ['ALERT_SMTP_HOST', 'ALERT_SMTP_PORT', 'ALERT_SMTP_USER', 'ALERT_SMTP_PASSWORD', 'ALERT_EMAIL_TO'] as const;
    const alertPresent = alertEmailKeys.filter((key) => vars[key] !== undefined);
    if (alertPresent.length > 0 && alertPresent.length < alertEmailKeys.length) {
      const missing = alertEmailKeys.filter((key) => vars[key] === undefined);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Partial alert-email config — set all of [${alertEmailKeys.join(', ')}] or none. Missing: ${missing.join(', ')}`,
        path: ['ALERT_SMTP_HOST'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Logger isn't safe to construct yet (it may read from env), so fail loudly on
    // stderr directly and exit before anything else in the process starts.
    // eslint-disable-next-line no-console
    console.error('FATAL: invalid environment configuration');
    for (const issue of result.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
