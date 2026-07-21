import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  illegalKeywordTransitionMessage,
  keywordNotAllowedForSenderMessage,
  MALFORMED_KEYWORD_MESSAGE,
  unknownOrderMessage,
} from '../../src/conversation/messages';
import { handleKeywordMessage } from '../../src/messaging/keywordProtocol.service';

const sendMessageMock = vi.fn().mockResolvedValue({ status: 'sent' });
vi.mock('../../src/messaging/send.service', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

const findOrderByNumberMock = vi.fn();
const flagOrderIssueMock = vi.fn();
vi.mock('../../src/domain/orders/order.service', () => ({
  findOrderByNumber: (...args: unknown[]) => findOrderByNumberMock(...args),
  flagOrderIssue: (...args: unknown[]) => flagOrderIssueMock(...args),
}));

const transitionOrderStatusMock = vi.fn();
const { FakeIllegalOrderTransitionError } = vi.hoisted(() => ({
  FakeIllegalOrderTransitionError: class extends Error {},
}));
vi.mock('../../src/domain/orders/order.statemachine', () => ({
  transitionOrderStatus: (...args: unknown[]) => transitionOrderStatusMock(...args),
  IllegalOrderTransitionError: FakeIllegalOrderTransitionError,
}));

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/domain/notifications/notification.service', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

const saveSessionMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/conversation/session.repository', () => ({
  saveSession: (...args: unknown[]) => saveSessionMock(...args),
}));

const testOrder = {
  id: 'order-1',
  orderNumber: 'WM-001',
  status: 'pickup_scheduled',
  user: { phoneNumber: '+2348011111111' },
  woshman: null,
  partner: null,
};

beforeEach(() => {
  sendMessageMock.mockClear();
  findOrderByNumberMock.mockReset();
  flagOrderIssueMock.mockReset();
  transitionOrderStatusMock.mockReset();
  notifyMock.mockClear();
  saveSessionMock.mockClear();
});

describe('handleKeywordMessage — malformed / unknown / wrong-sender', () => {
  it('malformed keyword replies with the malformed-keyword message and does nothing else', async () => {
    await handleKeywordMessage('woshman', '+2348099999999', 'blah blah');

    expect(sendMessageMock).toHaveBeenCalledWith({ to: '+2348099999999', body: MALFORMED_KEYWORD_MESSAGE });
    expect(findOrderByNumberMock).not.toHaveBeenCalled();
  });

  it('a keyword sent by the wrong sender type is rejected with a clear reply (READY is partner-only)', async () => {
    await handleKeywordMessage('woshman', '+2348099999999', 'READY WM-001');

    expect(sendMessageMock).toHaveBeenCalledWith({
      to: '+2348099999999',
      body: keywordNotAllowedForSenderMessage('READY'),
    });
    expect(findOrderByNumberMock).not.toHaveBeenCalled();
  });

  it('unknown order number replies with a clear "we don\'t have that order" message', async () => {
    findOrderByNumberMock.mockResolvedValue(null);

    await handleKeywordMessage('woshman', '+2348099999999', 'COLLECTED WM-999');

    expect(sendMessageMock).toHaveBeenCalledWith({ to: '+2348099999999', body: unknownOrderMessage('WM-999') });
    expect(transitionOrderStatusMock).not.toHaveBeenCalled();
  });
});

describe('handleKeywordMessage — illegal transitions', () => {
  it('an illegal transition is rejected with a clear reply, and no notification fires', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);
    transitionOrderStatusMock.mockRejectedValue(new FakeIllegalOrderTransitionError('nope'));

    await handleKeywordMessage('woshman', '+2348099999999', 'DELIVERED WM-001 10pcs');

    expect(sendMessageMock).toHaveBeenCalledWith({
      to: '+2348099999999',
      body: illegalKeywordTransitionMessage('WM-001', 'pickup_scheduled'),
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a genuinely unexpected error from the state machine is not swallowed', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);
    transitionOrderStatusMock.mockRejectedValue(new Error('db exploded'));

    await expect(handleKeywordMessage('woshman', '+2348099999999', 'COLLECTED WM-001')).rejects.toThrow('db exploded');
  });
});

describe('handleKeywordMessage — retried keyword (idempotency)', () => {
  it('a keyword whose target status matches the order\'s current status is a silent no-op — no transition attempt, no duplicate notification', async () => {
    findOrderByNumberMock.mockResolvedValue({ ...testOrder, status: 'picked_up' });

    await handleKeywordMessage('woshman', '+2348099999999', 'COLLECTED WM-001');

    expect(transitionOrderStatusMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

describe('handleKeywordMessage — successful keywords', () => {
  it('COLLECTED transitions to picked_up and fires the PICKED_UP notification', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);
    transitionOrderStatusMock.mockResolvedValue({ ...testOrder, status: 'picked_up' });

    await handleKeywordMessage('woshman', '+2348099999999', 'COLLECTED WM-001');

    expect(transitionOrderStatusMock).toHaveBeenCalledWith('order-1', 'picked_up', 'woshman', expect.any(String));
    expect(notifyMock).toHaveBeenCalledWith('PICKED_UP', 'order-1');
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it('READY (from a partner) transitions to ready_for_delivery and fires READY_FOR_DELIVERY', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);
    transitionOrderStatusMock.mockResolvedValue({ ...testOrder, status: 'ready_for_delivery' });

    await handleKeywordMessage('partner', '+2348099999999', 'READY WM-001');

    expect(transitionOrderStatusMock).toHaveBeenCalledWith('order-1', 'ready_for_delivery', 'partner', expect.any(String));
    expect(notifyMock).toHaveBeenCalledWith('READY_FOR_DELIVERY', 'order-1');
  });

  it('DELIVERED transitions to delivered, fires DELIVERED, logs the item count, and moves the customer session to FEEDBACK_PENDING', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);
    transitionOrderStatusMock.mockResolvedValue({ ...testOrder, status: 'delivered' });

    await handleKeywordMessage('woshman', '+2348099999999', 'DELIVERED WM-001 12pcs');

    expect(transitionOrderStatusMock).toHaveBeenCalledWith(
      'order-1',
      'delivered',
      'woshman',
      expect.stringContaining('12pcs'),
    );
    expect(notifyMock).toHaveBeenCalledWith('DELIVERED', 'order-1');
    expect(saveSessionMock).toHaveBeenCalledWith('+2348011111111', 'FEEDBACK_PENDING', { orderId: 'order-1' });
  });

  it('ISSUE flags the order (no status change, no notification) and never goes silent', async () => {
    findOrderByNumberMock.mockResolvedValue(testOrder);

    await handleKeywordMessage('partner', '+2348099999999', 'ISSUE WM-001 customer not home');

    expect(flagOrderIssueMock).toHaveBeenCalledWith('order-1', 'customer not home', 'partner');
    expect(transitionOrderStatusMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
