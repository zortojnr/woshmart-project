// Per-phone and global rate limiting on the Twilio-facing webhook routes (docs/
// BUILD_SCRIPT.md Phase 7 item 1). Twilio retries aggressively on non-2xx responses,
// so a rate-limited request still returns 200 + the same empty-TwiML/empty body the
// rest of this route uses on internal failures — a 429/403 here would just cause a
// retry storm that makes the load problem worse, not better.
import type { NextFunction, Request, Response } from 'express';
import { checkRateLimit } from '../lib/rateLimiter';
import { logger } from '../lib/logger';

const TWIML_EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const PHONE_LIMIT = 20;
const PHONE_WINDOW_MS = 60_000;

const GLOBAL_LIMIT = 300;
const GLOBAL_WINDOW_MS = 60_000;

function normalizePhoneNumber(raw: string): string {
  return raw.startsWith('whatsapp:') ? raw.slice('whatsapp:'.length) : raw;
}

// A Redis outage must not take the webhook down — fail open (allow the request) and
// log loudly, per CLAUDE.md's alerting philosophy (retry/degrade quietly, don't turn a
// transient infra blip into an outage of an unrelated system).
async function checkOrFailOpen(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const result = await checkRateLimit(key, limit, windowMs);
    return result.allowed;
  } catch (err) {
    logger.error({ err: (err as Error).message, key }, 'Rate limit check failed (Redis unreachable?) — failing open');
    return true;
  }
}

export function webhookGlobalRateLimit(routeName: string) {
  return async function globalRateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const allowed = await checkOrFailOpen(`webhook:global:${routeName}`, GLOBAL_LIMIT, GLOBAL_WINDOW_MS);
    if (!allowed) {
      logger.warn({ routeName }, 'Global webhook rate limit exceeded — backstop triggered');
      res.status(200).type('text/xml').send(TWIML_EMPTY_RESPONSE);
      return;
    }
    next();
  };
}

export async function webhookPhoneRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const from = typeof req.body?.From === 'string' ? req.body.From : null;
  if (!from) {
    // Malformed payload — let the route's own Zod validation reject it with the
    // usual empty-TwiML response rather than duplicating that decision here.
    next();
    return;
  }

  const phoneNumber = normalizePhoneNumber(from);
  const allowed = await checkOrFailOpen(`webhook:phone:${phoneNumber}`, PHONE_LIMIT, PHONE_WINDOW_MS);
  if (!allowed) {
    logger.warn({ phoneNumber }, 'Per-phone webhook rate limit exceeded');
    res.status(200).type('text/xml').send(TWIML_EMPTY_RESPONSE);
    return;
  }
  next();
}
