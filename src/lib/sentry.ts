// Error tracking (docs/BUILD_SCRIPT.md Phase 7 item 7). Init is safe to call with no
// DSN configured — the SDK just runs disabled (captureException becomes a no-op) rather
// than throwing, so this doesn't block boot before SENTRY_DSN is provisioned.
import * as Sentry from '@sentry/node';
import { env } from '../config/env';

export function initSentry(): void {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // No performance tracing at this scale (docs/TRD.md §7 Performance) — error
    // capture only.
    tracesSampleRate: 0,
  });
}

export { Sentry };
