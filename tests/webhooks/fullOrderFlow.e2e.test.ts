import twilio from 'twilio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createApp as CreateAppFn } from '../../src/app';
import {
  bankTransferInstructionsMessage,
  codConfirmationMessage,
  quoteMessageForBundle,
} from '../../src/conversation/messages';
import type { env as EnvType } from '../../src/config/env';
import type { prisma as PrismaType } from '../../src/db/client';
import { getPickupWindowByMenuReply } from '../../src/domain/orders/pickupWindows.config';

// Drives a real order end-to-end through the actual webhook/signature/DB/engine path.
// Only the Twilio send API is stubbed (no real credentials in CI, and no test here
// should actually send a WhatsApp message) — everything else is real.
let createMessageMock: ReturnType<typeof vi.fn>;
vi.mock('../../src/messaging/twilio.client', () => {
  let callCount = 0;
  createMessageMock = vi.fn().mockImplementation(() => {
    callCount += 1;
    return Promise.resolve({ sid: `SM_fake_full_flow_${callCount}`, status: 'queued' });
  });
  return { twilioClient: { messages: { create: createMessageMock } } };
});

let createApp: typeof CreateAppFn;
let env: typeof EnvType;
let prisma: typeof PrismaType;
let app: ReturnType<typeof CreateAppFn>;

const path = '/webhooks/twilio/inbound';
const testHost = 'localhost:3000';
const url = `http://${testHost}${path}`;

function sign(params: Record<string, string>) {
  return twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params);
}

async function postInbound(phoneNumber: string, body: string, messageSid: string) {
  const params = { MessageSid: messageSid, From: `whatsapp:${phoneNumber}`, To: env.TWILIO_WHATSAPP_NUMBER, Body: body };
  const signature = sign(params);
  return request(app).post(path).set('Host', testHost).set('X-Twilio-Signature', signature).type('form').send(params);
}

let sidCounter = 0;
function nextSid(): string {
  sidCounter += 1;
  return `SM_full_flow_${Date.now()}_${sidCounter}`;
}

describe('Full order flow — "hi" through to an orders row at awaiting_payment', () => {
  const transferPhone = `+234702${Date.now().toString().slice(-7)}`;
  const codPhone = `+234703${Date.now().toString().slice(-7)}`;

  beforeAll(async () => {
    ({ createApp } = await import('../../src/app'));
    ({ env } = await import('../../src/config/env'));
    ({ prisma } = await import('../../src/db/client'));
    app = createApp();
  });

  afterAll(async () => {
    for (const phoneNumber of [transferPhone, codPhone]) {
      const user = await prisma.user.findUnique({ where: { phoneNumber } });
      if (user) {
        const orders = await prisma.order.findMany({ where: { userId: user.id } });
        const orderIds = orders.map((o) => o.id);
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.message.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.message.deleteMany({ where: { phoneNumber } });
      await prisma.session.deleteMany({ where: { phoneNumber } });
    }
    await prisma.$disconnect();
  });

  it('bank transfer path: creates an order at awaiting_payment with correct pricing, and sends the exact bank transfer copy', async () => {
    await postInbound(transferPhone, 'hi', nextSid());
    await postInbound(transferPhone, 'Maitumbi', nextSid());
    await postInbound(transferPhone, '1', nextSid()); // Starter Bundle
    await postInbound(transferPhone, '15 Example Close, blue gate', nextSid());
    await postInbound(transferPhone, '2', nextSid()); // pickup window
    const res = await postInbound(transferPhone, '1', nextSid()); // bank transfer
    expect(res.status).toBe(200);

    const quoteSent = await prisma.message.findFirst({
      where: { phoneNumber: transferPhone, direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
    });
    expect(quoteSent?.body).toBe(quoteMessageForBundle('starter'));

    const confirmRes = await postInbound(transferPhone, 'YES', nextSid());
    expect(confirmRes.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: transferPhone } });
    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });

    expect(order.status).toBe('awaiting_payment');
    expect(order.serviceType).toBe('starter');
    expect(order.paymentMethod).toBe('transfer');
    expect(order.serviceTotalKobo).toBe(200_000n);
    expect(order.logisticsFeeKobo).toBe(100_000n);
    expect(order.smallBasketFeeKobo).toBe(0n);
    expect(order.grandTotalKobo).toBe(300_000n);
    expect(order.zone).toBe('Maitumbi');
    expect(order.address).toBe('15 Example Close, blue gate');
    expect(order.orderNumber).toMatch(/^WM-\d{3,}$/);

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['awaiting_confirmation', 'awaiting_payment']);

    const lastOutbound = await prisma.message.findFirst({
      where: { phoneNumber: transferPhone, direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
    });
    expect(lastOutbound?.body).toBe(bankTransferInstructionsMessage(300_000));

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber: transferPhone } });
    expect(session.state).toBe('AWAITING_PAYMENT');
    // context also carries the engine's own __lastPromptSent bookkeeping (used by the
    // media-fallback gate) — the business-relevant field is orderId.
    expect(session.context).toMatchObject({ orderId: order.id });
  });

  it('COD path: creates an order at awaiting_payment (order confirmed, cash collected at delivery) and ends the conversation at IDLE', async () => {
    await postInbound(codPhone, 'hi', nextSid());
    await postInbound(codPhone, 'Bosso', nextSid());
    await postInbound(codPhone, '3', nextSid()); // Family Bundle — free logistics
    await postInbound(codPhone, '9 Sample Avenue', nextSid());
    await postInbound(codPhone, '1', nextSid()); // pickup window
    await postInbound(codPhone, '2', nextSid()); // COD
    const confirmRes = await postInbound(codPhone, 'YES', nextSid());
    expect(confirmRes.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber: codPhone } });
    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });

    expect(order.status).toBe('awaiting_payment');
    expect(order.paymentMethod).toBe('cod');
    expect(order.serviceType).toBe('family');
    expect(order.logisticsFeeKobo).toBe(0n); // Family bundle (₦5,500) is above the ₦5,000 free-logistics threshold
    expect(order.grandTotalKobo).toBe(550_000n);

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber: codPhone } });
    expect(session.state).toBe('IDLE');
    // IDLE deliberately wipes business context (nothing more for the customer to do);
    // __lastPromptSent is the engine's own bookkeeping, not business state.
    expect(session.context).toMatchObject({});

    const window = getPickupWindowByMenuReply('1')!;
    const lastOutbound = await prisma.message.findFirst({
      where: { phoneNumber: codPhone, direction: 'outbound' },
      orderBy: { createdAt: 'desc' },
    });
    expect(lastOutbound?.body).toBe(codConfirmationMessage(550_000, window.label));
  });
});
