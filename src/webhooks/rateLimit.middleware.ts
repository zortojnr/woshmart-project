// Per-phone and global rate limiting on the Twilio-facing webhook routes (docs/
// BUILD_SCRIPT.md Phase 7 item 1). Twilio retries aggressively on non-2xx responses,
// so a rate-limited request still returns 200 + the same empty-TwiML/empty body the
// rest of this route uses on internal failures — a 429/403 here would just cause a
// retry storm that makes the load problem worse, not better.
import type { NextFunction, Request, Response } from 'express';
import { checkRateLimit } from '../lib/rateLimiter';
import { logger } from '../lib/logger';

const TWIML_EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// These two thresholds are backstop defaults against abuse/runaway loops, not derived
// from any Twilio-imposed limit — Twilio doesn't rate-limit how fast a customer can
// text us; it forwards inbound webhooks as fast as they arrive. (The outbound side is
// different — see send.service.ts's MIN_SEND_INTERVAL_MS, which does exist to respect
// Twilio/WhatsApp's outbound tier.)
//
// Rough math behind the numbers: a full order is ~8-10 customer messages end to end
// (WELCOME through FEEDBACK_PENDING), spread over minutes in real use. A worst-case
// legitimate burst — a few rapid typo-correction resends, or a couple of trips through
// the fallback handler's unmatched-input path — lands around 5-6 messages in a tight
// cluster. Hitting 21 messages in one 60s window would require a real person
// sustaining a message roughly every 3 seconds for a full minute straight, well past
// normal typing/thumb speed even accounting for corrections — so PHONE_LIMIT has
// comfortable headroom for genuine use.
//
// GLOBAL_LIMIT has even more margin at current expected scale (~100 concurrent users/
// month): realistic peak concurrent active conversations in any given minute is low
// single digits to low tens, not hundreds — even a pessimistic stack-up (20 customers
// simultaneously mid-conversation, each sending 2-3 messages in that same minute) lands
// around 40-60 requests, still well under 300.
//
// Review and adjust if real usage data says otherwise — these are not fixed forever,
// just the best estimate available before any real traffic exists to measure against.
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
