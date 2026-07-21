import twilio from 'twilio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createApp as CreateAppFn } from '../../src/app';
import {
  alreadyAtStatusMessage,
  FEEDBACK_PROMPT_MESSAGE,
  outForDeliveryMessage,
  readyForPickupAlertMessage,
  STATUS_UPDATE_MESSAGES,
} from '../../src/conversation/messages';
import type { env as EnvType } from '../../src/config/env';
import type { prisma as PrismaType } from '../../src/db/client';

// Drives a full Woshman/partner keyword lifecycle through the real webhook (real
// signature validation, real DB, real sender-type routing, real state machine, real
// notification fan-out) — only the Twilio send API is stubbed.
let sendMock: ReturnType<typeof vi.fn>;
vi.mock('../../src/messaging/twilio.client', () => {
  let callCount = 0;
  sendMock = vi.fn().mockImplementation(() => {
    callCount += 1;
    return Promise.resolve({ sid: `SM_fake_keyword_${callCount}`, status: 'queued' });
  });
  return { twilioClient: { messages: { create: sendMock } } };
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

async function postInbound(fromPhoneNumber: string, body: string, messageSid: string) {
  const params = { MessageSid: messageSid, From: `whatsapp:${fromPhoneNumber}`, To: env.TWILIO_WHATSAPP_NUMBER, Body: body };
  const signature = sign(params);
  return request(app).post(path).set('Host', testHost).set('X-Twilio-Signature', signature).type('form').send(params);
}

let sidCounter = 0;
function nextSid(): string {
  sidCounter += 1;
  return `SM_keyword_e2e_${Date.now()}_${sidCounter}`;
}

describe('Woshman/partner keyword protocol — full lifecycle through the real webhook', () => {
  const customerPhone = `+234706${Date.now().toString().slice(-7)}`;
  const woshmanPhone = `+234707${Date.now().toString().slice(-7)}`;
  const partnerPhone = `+234708${Date.now().toString().slice(-7)}`;
  let orderId: string;
  const orderNumber = `WM-E2E-${Date.now()}`;

  beforeAll(async () => {
    ({ createApp } = await import('../../src/app'));
    ({ env } = await import('../../src/config/env'));
    ({ prisma } = await import('../../src/db/client'));
    app = createApp();

    const user = await prisma.user.create({ data: { phoneNumber: customerPhone } });
    // A real customer always has a session row by the time an order exists (it's
    // created via the FSM) — this test creates the order directly for setup brevity,
    // so the session has to be seeded too, or the DELIVERED keyword's FEEDBACK_PENDING
    // transition would fail against a nonexistent row.
    await prisma.session.create({ data: { phoneNumber: customerPhone, state: 'IDLE', context: {} } });
    const woshman = await prisma.woshman.create({ data: { name: 'Test Woshman', phoneNumber: woshmanPhone } });
    const partner = await prisma.partner.create({ data: { name: 'Test Partner Laundry', phoneNumber: partnerPhone } });

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: user.id,
        woshmanId: woshman.id,
        partnerId: partner.id,
        address: '1 Test Street',
        zone: 'Maitumbi',
        serviceType: 'starter',
        serviceTotalKobo: 200_000n,
        grandTotalKobo: 300_000n,
        paymentMethod: 'transfer',
        status: 'pickup_scheduled',
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
    await prisma.message.deleteMany({ where: { OR: [{ phoneNumber: customerPhone }, { phoneNumber: woshmanPhone }, { phoneNumber: partnerPhone }] } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.session.deleteMany({ where: { phoneNumber: customerPhone } });
    await prisma.user.deleteMany({ where: { phoneNumber: customerPhone } });
    await prisma.woshman.deleteMany({ where: { phoneNumber: woshmanPhone } });
    await prisma.partner.deleteMany({ where: { phoneNumber: partnerPhone } });
    await prisma.$disconnect();
  });

  it('COLLECTED (Woshman) -> picked_up, customer notified', async () => {
    const res = await postInbound(woshmanPhone, `COLLECTED ${orderNumber}`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('picked_up');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: `whatsapp:${customerPhone}`, body: STATUS_UPDATE_MESSAGES.picked_up }));
  });

  it('LAUNDRY (Woshman) -> at_laundry, customer notified', async () => {
    const res = await postInbound(woshmanPhone, `LAUNDRY ${orderNumber}`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('at_laundry');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ to: `whatsapp:${customerPhone}`, body: STATUS_UPDATE_MESSAGES.at_laundry }));
  });

  it('a Woshman attempting READY (partner-only) is rejected, order status unchanged', async () => {
    const res = await postInbound(woshmanPhone, `READY ${orderNumber}`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('at_laundry');
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ to: `whatsapp:${woshmanPhone}` }));
  });

  it('READY (partner) -> ready_for_delivery, Woshman alerted (not the customer)', async () => {
    const res = await postInbound(partnerPhone, `READY ${orderNumber}`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('ready_for_delivery');
    expect(sendMock).toHaveBeenCalledTimes(4);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ to: `whatsapp:${woshmanPhone}`, body: readyForPickupAlertMessage(orderNumber) }));
  });

  it('DELIVERING (Woshman) -> out_for_delivery, customer notified with the Woshman\'s name', async () => {
    const res = await postInbound(woshmanPhone, `DELIVERING ${orderNumber}`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('out_for_delivery');
    expect(sendMock).toHaveBeenCalledTimes(5);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ to: `whatsapp:${customerPhone}`, body: outForDeliveryMessage('Test Woshman') }));
  });

  it('an unknown order number is rejected with a clear reply, no state change', async () => {
    const res = await postInbound(woshmanPhone, 'COLLECTED WM-DOES-NOT-EXIST', nextSid());
    expect(res.status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(6);
    expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({ to: `whatsapp:${woshmanPhone}` }));

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('out_for_delivery');
  });

  it('DELIVERED (Woshman, with pcs count) -> delivered, customer gets delivered message + feedback prompt, session moves to FEEDBACK_PENDING', async () => {
    const res = await postInbound(woshmanPhone, `DELIVERED ${orderNumber} 10pcs`, nextSid());
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('delivered');

    expect(sendMock).toHaveBeenCalledTimes(8); // +2: delivered message, feedback prompt
    expect(sendMock).toHaveBeenNthCalledWith(7, expect.objectContaining({ to: `whatsapp:${customerPhone}`, body: STATUS_UPDATE_MESSAGES.delivered }));
    expect(sendMock).toHaveBeenNthCalledWith(8, expect.objectContaining({ to: `whatsapp:${customerPhone}`, body: FEEDBACK_PROMPT_MESSAGE }));

    const session = await prisma.session.findUniqueOrThrow({ where: { phoneNumber: customerPhone } });
    expect(session.state).toBe('FEEDBACK_PENDING');
    expect(session.context).toMatchObject({ orderId });

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['picked_up', 'at_laundry', 'ready_for_delivery', 'out_for_delivery', 'delivered']);
    expect(history.every((h) => h.changedBy === 'woshman' || h.changedBy === 'partner')).toBe(true);
  });

  it('attempting DELIVERED again after already delivered is a no-op — no duplicate customer notification, but the Woshman gets a short acknowledgement', async () => {
    const res = await postInbound(woshmanPhone, `DELIVERED ${orderNumber} 10pcs`, nextSid());
    expect(res.status).toBe(200);

    // Re-sending the exact same target status IS the statemachine's idempotent no-op
    // (delivered -> delivered), so this succeeds quietly rather than erroring — it must
    // not re-notify the customer a second time, but the Woshman still gets told rather
    // than their message appearing to vanish.
    expect(sendMock).toHaveBeenCalledTimes(9);
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: `whatsapp:${woshmanPhone}`, body: alreadyAtStatusMessage(orderNumber, 'delivered') }),
    );
  });
});
