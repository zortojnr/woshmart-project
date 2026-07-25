import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchConfirmationMessage,
  FEEDBACK_PROMPT_MESSAGE,
  outForDeliveryMessage,
  partnerJobBriefMessage,
  readyForPickupAlertMessage,
  STATUS_UPDATE_MESSAGES,
  woshmanDispatchBriefMessage,
} from '../../../src/conversation/messages';
import { env } from '../../../src/config/env';
import { prisma } from '../../../src/db/client';
import { notify } from '../../../src/domain/notifications/notification.service';
import { getPickupWindowByMenuReply } from '../../../src/domain/orders/pickupWindows.config';
import { logger } from '../../../src/lib/logger';

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

const testCustomerPhone = `+234704${Date.now().toString().slice(-7)}`;
const testWoshmanPhone = `+234705${Date.now().toString().slice(-7)}`;
const testPartnerPhone = `+234706${Date.now().toString().slice(-7)}`;
let orderId: string;
let orderNumber: string;
let partnerId: string;
const assignedOrderIds: string[] = [];
const assignedUserPhones: string[] = [];

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

    const partner = await prisma.partner.create({
      data: { name: 'Test Partner Laundry', phoneNumber: testPartnerPhone, address: '1 Test Laundry Road' },
    });
    partnerId = partner.id;
  });

  beforeEach(() => {
    sendMessageMock.mockClear();
  });

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: assignedOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: assignedOrderIds } } });
    await prisma.user.deleteMany({ where: { phoneNumber: { in: [testCustomerPhone, ...assignedUserPhones] } } });
    await prisma.woshman.deleteMany({ where: { phoneNumber: testWoshmanPhone } });
    await prisma.partner.deleteMany({ where: { phoneNumber: testPartnerPhone } });
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

  async function makeAssignedOrder(overrides: { landmark?: string | null; pickupWindow?: string | null }) {
    const phoneNumber = `+234707${Date.now().toString().slice(-6)}${assignedOrderIds.length}`;
    const user = await prisma.user.create({ data: { phoneNumber } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `WM-NOTIFY-ASSIGNED-${Date.now()}-${assignedOrderIds.length}`,
        userId: user.id,
        woshmanId: (await prisma.woshman.findUniqueOrThrow({ where: { phoneNumber: testWoshmanPhone } })).id,
        partnerId,
        address: '15 Example Close',
        landmark: overrides.landmark ?? null,
        zone: 'Maitumbi',
        serviceType: 'starter',
        itemsDescription: 'Starter Bundle items',
        serviceTotalKobo: 200_000n,
        grandTotalKobo: 300_000n,
        paymentMethod: 'transfer',
        pickupWindow: overrides.pickupWindow ?? null,
        status: 'assigned',
      },
    });
    assignedOrderIds.push(order.id);
    assignedUserPhones.push(phoneNumber);
    return { order, customerPhone: phoneNumber };
  }

  it('ASSIGNED sends the exact multi-line dispatch brief, with the landmark line included', async () => {
    const { order, customerPhone } = await makeAssignedOrder({ landmark: 'blue gate', pickupWindow: '2' });

    await notify('ASSIGNED', order.id);

    const dispatchLabel = getPickupWindowByMenuReply('2')!.dispatchLabel;
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: customerPhone,
      body: dispatchConfirmationMessage('Test Woshman'),
    });
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: testWoshmanPhone,
      body: woshmanDispatchBriefMessage({
        orderNumber: order.orderNumber,
        address: '15 Example Close',
        landmark: 'blue gate',
        pickupWindow: dispatchLabel,
      }),
    });
    const woshmanCall = sendMessageMock.mock.calls.find((call) => call[0].to === testWoshmanPhone)!;
    expect(woshmanCall[0].body).toBe(
      `New job: ${order.orderNumber}\nPickup: 15 Example Close, blue gate\nTime: Today afternoon, 12PM–4PM\nReply COLLECTED ${order.orderNumber} once picked up.`,
    );
    expect(sendMessageMock).toHaveBeenCalledWith({
      to: testPartnerPhone,
      body: partnerJobBriefMessage({
        orderNumber: order.orderNumber,
        serviceType: 'starter',
        itemsDescription: 'Starter Bundle items',
      }),
    });
  });

  it('ASSIGNED omits the landmark line entirely when the order has no landmark', async () => {
    const { order } = await makeAssignedOrder({ landmark: null, pickupWindow: '4' });

    await notify('ASSIGNED', order.id);

    const woshmanCall = sendMessageMock.mock.calls.find((call) => call[0].to === testWoshmanPhone)!;
    expect(woshmanCall[0].body).toBe(
      `New job: ${order.orderNumber}\nPickup: 15 Example Close\nTime: Tomorrow morning\nReply COLLECTED ${order.orderNumber} once picked up.`,
    );
  });

  it('ASSIGNED degrades to "TBC" in the dispatch brief when the stored pickup window does not resolve', async () => {
    const { order } = await makeAssignedOrder({ landmark: null, pickupWindow: null });

    await notify('ASSIGNED', order.id);

    const woshmanCall = sendMessageMock.mock.calls.find((call) => call[0].to === testWoshmanPhone)!;
    expect(woshmanCall[0].body).toBe(
      `New job: ${order.orderNumber}\nPickup: 15 Example Close\nTime: TBC\nReply COLLECTED ${order.orderNumber} once picked up.`,
    );
  });
});
