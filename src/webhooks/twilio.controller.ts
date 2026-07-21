import type { Request, Response } from 'express';
import { z } from 'zod';
import { processInboundMessage } from '../conversation/engine';
import { prisma } from '../db/client';
import { findWoshmanByPhone } from '../domain/woshmen/woshman.service';
import { findPartnerByPhone } from '../domain/partners/partner.service';
import { logger } from '../lib/logger';
import { handleKeywordMessage } from '../messaging/keywordProtocol.service';

const TWIML_EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function normalizePhoneNumber(raw: string): string {
  return raw.startsWith('whatsapp:') ? raw.slice('whatsapp:'.length) : raw;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

const inboundSchema = z.object({
  MessageSid: z.string().min(1),
  From: z.string().min(1),
  Body: z.string().optional(),
  NumMedia: z.string().optional(),
});

// POST /webhooks/twilio/inbound — customer, Woshman, or partner message. Validate
// signature (upstream middleware), dedupe by MessageSid, persist, then route: a known
// Woshman/partner number goes to the keyword protocol, everyone else to the customer
// conversation FSM (docs/TRD.md §4 sender-type routing).
export async function handleInboundWebhook(req: Request, res: Response): Promise<void> {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'Malformed inbound Twilio webhook payload');
    res.status(200).type('text/xml').send(TWIML_EMPTY_RESPONSE);
    return;
  }

  const { MessageSid, From, Body, NumMedia } = parsed.data;
  const phoneNumber = normalizePhoneNumber(From);
  const hasMedia = Number.parseInt(NumMedia ?? '0', 10) > 0;

  let isDuplicate = false;
  try {
    await prisma.message.create({
      data: {
        twilioSid: MessageSid,
        direction: 'inbound',
        phoneNumber,
        body: Body ?? null,
        status: 'received',
        rawPayload: req.body as object,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      isDuplicate = true;
      logger.info({ messageSid: MessageSid }, 'Duplicate inbound webhook — already processed, skipping');
    } else {
      throw err;
    }
  }

  if (!isDuplicate) {
    try {
      const [woshman, partner] = await Promise.all([
        findWoshmanByPhone(phoneNumber),
        findPartnerByPhone(phoneNumber),
      ]);

      if (woshman) {
        await handleKeywordMessage('woshman', phoneNumber, Body ?? '');
      } else if (partner) {
        await handleKeywordMessage('partner', phoneNumber, Body ?? '');
      } else {
        await processInboundMessage(phoneNumber, Body ?? '', hasMedia);
      }
    } catch (err) {
      // A processing failure must never surface as a failed webhook — Twilio would
      // retry the whole delivery, and the inbound message row is already persisted
      // (idempotency dedupe above would then just skip it next time).
      logger.error(
        { err: (err as Error).message, messageSid: MessageSid, phoneNumber },
        'Failed to process inbound message',
      );
    }
  }

  res.status(200).type('text/xml').send(TWIML_EMPTY_RESPONSE);
}

const statusSchema = z.object({
  MessageSid: z.string().min(1),
  MessageStatus: z.string().min(1),
});

// POST /webhooks/twilio/status — delivery/read callbacks for outbound messages.
// Idempotent by construction: repeated identical status updates just re-set the
// same value, no duplicate rows.
export async function handleStatusWebhook(req: Request, res: Response): Promise<void> {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'Malformed Twilio status webhook payload');
    res.status(200).end();
    return;
  }

  const { MessageSid, MessageStatus } = parsed.data;

  const result = await prisma.message.updateMany({
    where: { twilioSid: MessageSid },
    data: { status: MessageStatus },
  });

  if (result.count === 0) {
    logger.warn({ messageSid: MessageSid }, 'Status callback for unknown message SID');
  }

  res.status(200).end();
}
