import twilio from 'twilio';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db/client';

const app = createApp();
const path = '/webhooks/twilio/inbound';
// supertest binds an ephemeral port per run, so the real Host header would be
// unpredictable — force it to a fixed value so the URL used to compute the test
// signature always matches what resolvePublicUrl() reconstructs server-side.
const testHost = 'localhost:3000';
const url = `http://${testHost}${path}`;

function signedParams(overrides: Record<string, string> = {}) {
  return {
    MessageSid: `SM_sig_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    From: 'whatsapp:+2348011111111',
    To: env.TWILIO_WHATSAPP_NUMBER,
    Body: 'Hi',
    ...overrides,
  };
}

describe('Twilio webhook signature validation', () => {
  const createdSids: string[] = [];

  afterAll(async () => {
    if (createdSids.length > 0) {
      await prisma.message.deleteMany({ where: { twilioSid: { in: createdSids } } });
    }
    await prisma.$disconnect();
  });

  it('accepts a genuinely-signed request computed with the real Twilio algorithm', async () => {
    const params = signedParams();
    createdSids.push(params.MessageSid);
    const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params);

    const res = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);

    expect(res.status).toBe(200);
  });

  it('rejects a tampered request (payload changed after signing) with 403', async () => {
    const params = signedParams();
    const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params);

    // Sign one payload, send a different one — simulates a MITM/tamper attempt.
    const tamperedParams = { ...params, Body: 'tampered body' };

    const res = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(tamperedParams);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid twilio signature/i);
  });

  it('rejects a request with a garbage signature with 403', async () => {
    const params = signedParams();

    const res = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', 'not-a-real-signature')
      .type('form')
      .send(params);

    expect(res.status).toBe(403);
  });

  it('rejects a request with no signature header at all with 403', async () => {
    const params = signedParams();

    const res = await request(app).post(path).set('Host', testHost).type('form').send(params);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/missing twilio signature/i);
  });
});
