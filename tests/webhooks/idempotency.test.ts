import twilio from 'twilio';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db/client';

const app = createApp();
const testHost = 'localhost:3000';

function sign(path: string, params: Record<string, string>) {
  const url = `http://${testHost}${path}`;
  return twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params);
}

describe('Webhook idempotency', () => {
  const createdSids: string[] = [];

  afterAll(async () => {
    if (createdSids.length > 0) {
      await prisma.message.deleteMany({ where: { twilioSid: { in: createdSids } } });
    }
    await prisma.$disconnect();
  });

  it('processing the same inbound MessageSid twice creates exactly one message row', async () => {
    const path = '/webhooks/twilio/inbound';
    const messageSid = `SM_idem_test_${Date.now()}`;
    createdSids.push(messageSid);
    const params = {
      MessageSid: messageSid,
      From: 'whatsapp:+2348022222222',
      To: env.TWILIO_WHATSAPP_NUMBER,
      Body: 'duplicate delivery test',
    };
    const signature = sign(path, params);

    const first = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);
    const second = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await prisma.message.findMany({ where: { twilioSid: messageSid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('duplicate delivery test');
  });

  it('the same status callback processed twice does not duplicate rows and lands in the same end state', async () => {
    const messageSid = `SM_idem_status_${Date.now()}`;
    createdSids.push(messageSid);
    await prisma.message.create({
      data: {
        twilioSid: messageSid,
        direction: 'outbound',
        phoneNumber: '+2348033333333',
        status: 'sent',
      },
    });

    const path = '/webhooks/twilio/status';
    const params = { MessageSid: messageSid, MessageStatus: 'delivered' };
    const signature = sign(path, params);

    const first = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);
    const second = await request(app)
      .post(path)
      .set('Host', testHost)
      .set('X-Twilio-Signature', signature)
      .type('form')
      .send(params);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await prisma.message.findMany({ where: { twilioSid: messageSid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('delivered');
  });
});
