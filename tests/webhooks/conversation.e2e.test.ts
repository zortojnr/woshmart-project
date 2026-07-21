import twilio from 'twilio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { createApp as CreateAppFn } from '../../src/app';
import { coverageConfirmedMessage, WELCOME_MESSAGE } from '../../src/conversation/messages';
import type { env as EnvType } from '../../src/config/env';
import type { prisma as PrismaType } from '../../src/db/client';

// The integration test drives real inbound webhooks through real signature
// validation, the real conversation engine, and the real database — the only thing
// stubbed is the network call to Twilio's send API (CLAUDE.md rule 2: no real
// credentials in CI; also keeps the test from actually sending WhatsApp messages).
let createMessageMock: ReturnType<typeof vi.fn>;
vi.mock('../../src/messaging/twilio.client', () => {
  // twilioSid is unique in the messages table — a fixed fake sid across multiple
  // sends would collide and (correctly) trigger the send service's own retry path,
  // which isn't what this test is exercising. Each call gets its own sid instead.
  let callCount = 0;
  createMessageMock = vi.fn().mockImplementation(() => {
    callCount += 1;
    return Promise.resolve({ sid: `SM_fake_outbound_${callCount}`, status: 'queued' });
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

describe('Conversation engine — two-turn WELCOME -> COVERAGE_CHECK, driven through the real webhook', () => {
  const phoneNumber = `+234701${Date.now().toString().slice(-7)}`;

  beforeAll(async () => {
    ({ createApp } = await import('../../src/app'));
    ({ env } = await import('../../src/config/env'));
    ({ prisma } = await import('../../src/db/client'));
    app = createApp();
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { phoneNumber } });
    await prisma.session.deleteMany({ where: { phoneNumber } });
    await prisma.$disconnect();
  });

  it('turn 1: first message creates a session, sends the exact welcome copy, advances to COVERAGE_CHECK', async () => {
    const res = await postInbound(phoneNumber, 'Hi', `SM_e2e_turn1_${Date.now()}`);
    expect(res.status).toBe(200);

    expect(createMessageMock).toHaveBeenCalledTimes(1);
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: `whatsapp:${phoneNumber}`, body: WELCOME_MESSAGE }),
    );

    const session = await prisma.session.findUnique({ where: { phoneNumber } });
    expect(session?.state).toBe('COVERAGE_CHECK');

    const outbound = await prisma.message.findMany({ where: { phoneNumber, direction: 'outbound' } });
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.body).toBe(WELCOME_MESSAGE);
    expect(outbound[0]?.twilioSid).toBe('SM_fake_outbound_1');
  });

  it('turn 2: an in-zone area reply gets the exact bundle menu and advances to SERVICE_SELECTION', async () => {
    const res = await postInbound(phoneNumber, 'Maitumbi', `SM_e2e_turn2_${Date.now()}`);
    expect(res.status).toBe(200);

    expect(createMessageMock).toHaveBeenCalledTimes(2);
    expect(createMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: `whatsapp:${phoneNumber}`, body: coverageConfirmedMessage('Maitumbi') }),
    );

    const session = await prisma.session.findUnique({ where: { phoneNumber } });
    expect(session?.state).toBe('SERVICE_SELECTION');
    // Also carries the engine's own __lastPromptSent bookkeeping (Phase 3) — the
    // business-relevant field is area.
    expect(session?.context).toMatchObject({ area: 'Maitumbi' });

    const outbound = await prisma.message.findMany({
      where: { phoneNumber, direction: 'outbound' },
      orderBy: { createdAt: 'asc' },
    });
    expect(outbound).toHaveLength(2);
    expect(outbound[1]?.body).toBe(coverageConfirmedMessage('Maitumbi'));
  });

  it('turn 3: SERVICE_SELECTION now has a real handler (Phase 3) — a valid bundle reply advances the FSM further', async () => {
    const res = await postInbound(phoneNumber, '1', `SM_e2e_turn3_${Date.now()}`);
    expect(res.status).toBe(200);
    expect(createMessageMock).toHaveBeenCalledTimes(3);

    const session = await prisma.session.findUnique({ where: { phoneNumber } });
    expect(session?.state).toBe('ADDRESS_COLLECTION');
  });
});
