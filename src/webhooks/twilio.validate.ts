import type { NextFunction, Request, Response } from 'express';
import twilio from 'twilio';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// Twilio recommends validating against the exact public URL it called, not whatever
// Express thinks the URL is locally — behind Render's proxy that means trusting the
// forwarded proto/host headers, not req.protocol directly.
function resolvePublicUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]!.trim() : req.protocol;

  const forwardedHost = req.headers['x-forwarded-host'];
  const host = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0]!.trim() : req.get('host');

  return `${protocol}://${host}${req.originalUrl}`;
}

// Validates the X-Twilio-Signature header using the official Twilio SDK helper
// (twilio.validateRequest). This is the highest-priority security control in the
// system — no route touching /webhooks/twilio/* runs anything else before this passes.
export function validateTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.header('X-Twilio-Signature');
  if (!signature) {
    logger.warn({ path: req.originalUrl }, 'Rejected webhook request: missing X-Twilio-Signature header');
    res.status(403).json({ error: 'Missing Twilio signature' });
    return;
  }

  const url = resolvePublicUrl(req);
  const params = (req.body ?? {}) as Record<string, string>;

  const isValid = twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
  if (!isValid) {
    logger.warn({ path: req.originalUrl, url }, 'Rejected webhook request: invalid Twilio signature');
    res.status(403).json({ error: 'Invalid Twilio signature' });
    return;
  }

  next();
}
