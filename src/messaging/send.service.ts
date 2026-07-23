import { env } from '../config/env';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { twilioClient } from './twilio.client';

// The only code path that calls Twilio's send API (CLAUDE.md rule 5). Everything else
// — conversation engine, keyword parser, Admin API, timeout jobs — goes through the
// Notification Service, which calls this.

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const BASE_DELAY_MS = 500;

// Twilio error codes that mean "this will never succeed, don't retry":
// 21211/21614 invalid or non-mobile 'To' number, 21610 recipient opted out.
const PERMANENT_TWILIO_ERROR_CODES = new Set([21211, 21614, 21610]);

interface TwilioSdkError {
  status?: number;
  code?: number;
  message?: string;
}

function isTransientError(err: unknown): boolean {
  const twilioErr = err as TwilioSdkError;

  if (typeof twilioErr.code === 'number' && PERMANENT_TWILIO_ERROR_CODES.has(twilioErr.code)) {
    return false;
  }
  if (typeof twilioErr.status === 'number') {
    return twilioErr.status === 429 || twilioErr.status >= 500;
  }
  // No HTTP status at all means the request never got a response — network error or
  // timeout. Treat as transient.
  return true;
}

function delayForAttempt(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Outbound throttle (docs/BUILD_SCRIPT.md Phase 7 item 1): a new/unrated WhatsApp
// sender is limited by Twilio/Meta to roughly one message per second — this module is
// the only code path that ever calls Twilio's send API (CLAUDE.md rule 5), so a single
// in-process minimum-interval gate is enough to enforce that across every send,
// without needing distributed coordination. (If this service is ever scaled to
// multiple instances, this would need to move to a shared Redis-backed limiter — not
// needed at current single-instance, low-hundreds-of-orders/month scale.)
const MIN_SEND_INTERVAL_MS = 1000;
let nextSendSlotAt = 0;

async function waitForSendSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = nextSendSlotAt - now;
  nextSendSlotAt = Math.max(now, nextSendSlotAt) + MIN_SEND_INTERVAL_MS;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function toWhatsAppAddress(phoneNumber: string): string {
  return phoneNumber.startsWith('whatsapp:') ? phoneNumber : `whatsapp:${phoneNumber}`;
}

function stripWhatsAppPrefix(phoneNumber: string): string {
  return phoneNumber.startsWith('whatsapp:') ? phoneNumber.slice('whatsapp:'.length) : phoneNumber;
}

export interface SendMessageInput {
  to: string;
  body: string;
}

export interface SendMessageResult {
  status: 'sent' | 'failed';
  twilioSid?: string;
}

export async function sendMessage({ to, body }: SendMessageInput): Promise<SendMessageResult> {
  const toAddress = toWhatsAppAddress(to);
  const phoneNumber = stripWhatsAppPrefix(to);

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await waitForSendSlot();
      const message = await twilioClient.messages.create({
        from: env.TWILIO_WHATSAPP_NUMBER,
        to: toAddress,
        body,
      });

      await prisma.message.create({
        data: {
          twilioSid: message.sid,
          direction: 'outbound',
          phoneNumber,
          body,
          status: message.status ?? 'queued',
        },
      });

      return { status: 'sent', twilioSid: message.sid };
    } catch (err) {
      lastError = err;
      const transient = isTransientError(err);
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

      logger.warn(
        { err: (err as TwilioSdkError).message, to: phoneNumber, attempt, transient },
        'Outbound WhatsApp send attempt failed',
      );

      if (!transient || isLastAttempt) {
        break;
      }

      await sleep(delayForAttempt(attempt));
    }
  }

  logger.error(
    { err: (lastError as TwilioSdkError)?.message, to: phoneNumber },
    'Outbound WhatsApp send failed permanently — logged as failed, not retried further',
  );

  await prisma.message.create({
    data: {
      direction: 'outbound',
      phoneNumber,
      body,
      status: 'failed',
    },
  });

  return { status: 'failed' };
}
