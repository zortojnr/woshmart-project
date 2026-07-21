import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';

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
});

// POST /webhooks/twilio/inbound — customer, Woshman, or partner message.
// No FSM/keyword routing yet (Phase 2+): this phase only proves the pipe is secure
// and idempotent — validate signature (upstream middleware), dedupe by MessageSid,
// persist, respond fast.
export async function handleInboundWebhook(req: Request, res: Response): Promise<void> {
  const parsed = inboundSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'Malformed inbound Twilio webhook payload');
    res.status(200).type('text/xml').send(TWIML_EMPTY_RESPONSE);
    return;
  }

  const { MessageSid, From, Body } = parsed.data;
  const phoneNumber = normalizePhoneNumber(From);

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
      logger.info({ messageSid: MessageSid }, 'Duplicate inbound webhook — already processed, skipping');
    } else {
      throw err;
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
