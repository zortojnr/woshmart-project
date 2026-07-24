import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// POST /admin/diagnostics/test-error — deliberately throws so a super_admin can verify
// Sentry capture end to end once SENTRY_DSN is configured (docs/BUILD_SCRIPT.md Phase 7
// item 7). Not audit-logged: it never reaches a 2xx response, so auditGuardMiddleware's
// gap check (which only fires on a successful write) never flags it.
// eslint-disable-next-line @typescript-eslint/require-await
export async function triggerTestError(_req: AuthenticatedRequest, _res: Response): Promise<void> {
  throw new Error('Deliberate test error — Sentry capture verification (docs/BUILD_SCRIPT.md Phase 7 item 7)');
}
