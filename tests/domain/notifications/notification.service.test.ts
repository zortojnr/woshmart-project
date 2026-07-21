import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_PROMPT_MESSAGE,
  outForDeliveryMessage,
  readyForPickupAlertMessage,
  STATUS_UPDATE_MESSAGES,
} from '../../../src/conversation/messages';
import { prisma } from '../../../src/db/client';
import { notify } from '../../../src/domain/notifications/notification.service';

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
