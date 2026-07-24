// Per-admin / per-IP rate limiting on the Admin API (docs/BUILD_SCRIPT.md Phase 7
// item 1). Unlike the Twilio webhooks, a rate-limited admin request can safely return
// a real 429 — Retool and any other admin client is expected to see and back off from
// a normal HTTP error, there's no retry-storm concern from an authenticated caller.
import type { NextFunction, Response } from 'express';
import { checkRateLimit } from '../../lib/rateLimiter';
import { TooManyRequestsError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthenticatedRequest } from './auth.middleware';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

const ADMIN_LIMIT = 120;
const ADMIN_WINDOW_MS = 60_000;

// A Redis outage must not lock every admin out of the dashboard — fail open and log
// loudly, consistent with the webhook rate limiter's failure mode.
async function checkOrFailOpen(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const result = await checkRateLimit(key, limit, windowMs);
    return result.allowed;
  } catch (err) {
    logger.error({ err: (err as Error).message, key }, 'Admin rate limit check failed (Redis unreachable?) — failing open');
    return true;
  }
}

// Keyed by IP since there's no authenticated admin yet at the login route — guards
// against credential-stuffing/brute-force attempts.
export async function loginRateLimit(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  const allowed = await checkOrFailOpen(`admin:login:${req.ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!allowed) {
    logger.warn({ ip: req.ip }, 'Login rate limit exceeded');
    next(new TooManyRequestsError('Too many login attempts — try again later'));
    return;
  }
  next();
}

// Must run after authMiddleware, which populates req.admin. Keyed by admin id, not
// IP, so a shared office IP doesn't throttle every admin at once.
export async function adminRateLimit(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  const key = req.admin?.id ?? req.ip ?? 'unknown';
  const allowed = await checkOrFailOpen(`admin:api:${key}`, ADMIN_LIMIT, ADMIN_WINDOW_MS);
  if (!allowed) {
    logger.warn({ adminId: req.admin?.id }, 'Admin API rate limit exceeded');
    next(new TooManyRequestsError('Too many requests — slow down'));
    return;
  }
  next();
}
