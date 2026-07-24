import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_PROMPT_MESSAGE,
  outForDeliveryMessage,
  readyForPickupAlertMessage,
  STATUS_UPDATE_MESSAGES,
} from '../../../src/conversation/messages';
import { env } from '../../../src/config/env';
import { prisma } from '../../../src/db/client';
import { notify } from '../../../src/domain/notifications/notification.service';
import { logger } from '../../../src/lib/logger';

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

const testCustomerPhone = `+234704${Date.now().toString().slice(-7)}`;
const testWoshmanPhone = `+234705${Date.now().toString().slice(-7)}`;
let orderId: string;
let orderNumber: string;

describe('notification.service — notify', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { phoneNumber: testCustomerPhone } });
    const woshman = await prisma.woshman.create({ data: { name: 'Test Woshman', phoneNumber: testWoshmanPhone } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `WM-NOTIFY-TEST-${Date.now()}`,
        userId: user.id,
        woshmanId: woshman.id,
        address: '1 Test Street',
        zone: 'Maitumbi',
        serviceType: 'starter',
        serviceTotalKobo: 200_000n,
        grandTotalKobo: 300_000n,
        paymentMethod: 'transfer',
        status: 'picked_up',
      },
    });
    orderId = order.id;
    orderNumber = order.orderNumber;
  });

  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.user.deleteMany({ where: { phoneNumber: testCustomerPhone } });
    await prisma.woshman.deleteMany({ where: { phoneNumber: testWoshmanPhone } });
    await prisma.$disconnect();
  });

  it('PICKED_UP notifies only the customer', async () => {
    await notify('PICKED_UP', orderId);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({ to: testCustomerPhone, body: STATUS_UPDATE_MESSAGES.picked_up });
  });

  it('AT_LAUNDRY notifies only the customer', async () => {
    await notify('AT_LAUNDRY', orderId);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({ to: testCustomerPhone, body: STATUS_UPDATE_MESSAGES.at_laundry });
  });

  it('READY_FOR_DELIVERY alerts the assigned Woshman, not the customer', async () => {
    await notify('READY_FOR_DELIVERY', orderId);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: testWoshmanPhone,
      body: readyForPickupAlertMessage(orderNumber),
    });
  });

  it("OUT_FOR_DELIVERY notifies the customer with the Woshman's name", async () => {
    await notify('OUT_FOR_DELIVERY', orderId);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: testCustomerPhone,
      body: outForDeliveryMessage('Test Woshman'),
    });
  });

  it('DELIVERED sends both the delivered message and the feedback prompt to the customer', async () => {
    await notify('DELIVERED', orderId);
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock).toHaveBeenNthCalledWith(1, { to: testCustomerPhone, body: STATUS_UPDATE_MESSAGES.delivered });
    expect(sendMessageMock).toHaveBeenNthCalledWith(2, { to: testCustomerPhone, body: FEEDBACK_PROMPT_MESSAGE });
  });

  it('DELIVERED falls back to free text (no contentSid key at all) when the template env vars are unset', async () => {
    expect(env.TWILIO_CONTENT_SID_DELIVERY_NOTICE).toBeUndefined();
    expect(env.TWILIO_CONTENT_SID_FEEDBACK_NUDGE).toBeUndefined();

    await notify('DELIVERED', orderId);

    // Neither call should have a contentSid property at all in this state — not
    // contentSid: undefined, genuinely absent, matching send.service.ts's
    // exactOptionalPropertyTypes contract.
    expect(sendMessageMock.mock.calls[0]?.[0]).not.toHaveProperty('contentSid');
    expect(sendMessageMock.mock.calls[1]?.[0]).not.toHaveProperty('contentSid');
  });

  it('DELIVERED passes contentSid through once the template env vars are configured', async () => {
    env.TWILIO_CONTENT_SID_DELIVERY_NOTICE = 'HXdeliverytest';
    env.TWILIO_CONTENT_SID_FEEDBACK_NUDGE = 'HXfeedbacktest';

    try {
      await notify('DELIVERED', orderId);

      expect(sendMessageMock).toHaveBeenNthCalledWith(1, {
        to: testCustomerPhone,
        body: STATUS_UPDATE_MESSAGES.delivered,
        contentSid: 'HXdeliverytest',
      });
      expect(sendMessageMock).toHaveBeenNthCalledWith(2, {
        to: testCustomerPhone,
        body: FEEDBACK_PROMPT_MESSAGE,
        contentSid: 'HXfeedbacktest',
      });
    } finally {
      env.TWILIO_CONTENT_SID_DELIVERY_NOTICE = undefined;
      env.TWILIO_CONTENT_SID_FEEDBACK_NUDGE = undefined;
    }
  });

  it('DELIVERED logs an info-level fallback line only for whichever template is unconfigured', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    env.TWILIO_CONTENT_SID_DELIVERY_NOTICE = 'HXdeliverytest';
    env.TWILIO_CONTENT_SID_FEEDBACK_NUDGE = undefined;

    try {
      await notify('DELIVERED', orderId);

      const fallbackLines = infoSpy.mock.calls.filter((call) => typeof call[1] === 'string' && call[1].includes('sent as free text'));
      expect(fallbackLines).toHaveLength(1);
      expect(fallbackLines[0]?.[1]).toMatch(/^Feedback nudge/);
    } finally {
      env.TWILIO_CONTENT_SID_DELIVERY_NOTICE = undefined;
      infoSpy.mockRestore();
    }
  });

  it('READY_FOR_DELIVERY with no Woshman assigned logs and sends nothing, without throwing', async () => {
    const user2 = await prisma.user.create({ data: { phoneNumber: `${testCustomerPhone}9` } });
    const orphanOrder = await prisma.order.create({
      data: {
        orderNumber: `WM-NOTIFY-ORPHAN-${Date.now()}`,
        userId: user2.id,
        address: '1 Test Street',
        zone: 'Maitumbi',
        serviceType: 'starter',
        serviceTotalKobo: 200_000n,
        grandTotalKobo: 300_000n,
        paymentMethod: 'transfer',
        status: 'at_laundry',
      },
    });

    await expect(notify('READY_FOR_DELIVERY', orphanOrder.id)).resolves.toBeUndefined();
    expect(sendMessageMock).not.toHaveBeenCalled();

    await prisma.order.delete({ where: { id: orphanOrder.id } });
    await prisma.user.delete({ where: { id: user2.id } });
  });
});
