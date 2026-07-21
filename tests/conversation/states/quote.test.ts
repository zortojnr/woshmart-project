import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bankTransferInstructionsMessage, codConfirmationMessage, quoteMessageForBundle } from '../../../src/conversation/messages';
import { quoteHandler } from '../../../src/conversation/states/quote';
import type { SessionContext } from '../../../src/conversation/types';
import { getPickupWindowByMenuReply } from '../../../src/domain/orders/pickupWindows.config';

const createOrderFromQuoteMock = vi.fn();
vi.mock('../../../src/domain/orders/order.service', () => ({
  createOrderFromQuote: (...args: unknown[]) => createOrderFromQuoteMock(...args),
}));

function ctx(context: Record<string, unknown>): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'QUOTE_PENDING', context };
}

const completeDraft = {
  area: 'Maitumbi',
  bundleId: 'family' as const,
  address: '12 Example Street',
  pickupWindowId: '2',
  paymentMethod: 'transfer' as const,
};

beforeEach(() => {
  createOrderFromQuoteMock.mockReset();
});

describe('quoteHandler', () => {
  it('NO cancels: IDLE, no order created, no message (no PRD copy specified for decline)', async () => {
    const result = await quoteHandler.handle(ctx(completeDraft), 'NO');

    expect(result.nextState).toBe('IDLE');
    expect(result.nextContext).toEqual({});
    expect(result.outboundMessages).toEqual([]);
    expect(createOrderFromQuoteMock).not.toHaveBeenCalled();
  });

  it('an unmatched reply re-sends the exact quote for the selected bundle', async () => {
    const result = await quoteHandler.handle(ctx(completeDraft), 'maybe');

    expect(result.nextState).toBe('QUOTE_PENDING');
    expect(result.outboundMessages).toEqual([{ body: quoteMessageForBundle('family') }]);
    expect(createOrderFromQuoteMock).not.toHaveBeenCalled();
  });

  it('YES with bank transfer creates the order and sends bank transfer instructions, advancing to AWAITING_PAYMENT', async () => {
    createOrderFromQuoteMock.mockResolvedValue({ id: 'order-1', grandTotalKobo: 550_000n });

    const result = await quoteHandler.handle(ctx(completeDraft), 'YES');

    expect(createOrderFromQuoteMock).toHaveBeenCalledWith({
      phoneNumber: '+2348011111111',
      zone: 'Maitumbi',
      address: '12 Example Street',
      bundleId: 'family',
      pickupWindow: getPickupWindowByMenuReply('2'),
      paymentMethod: 'transfer',
    });
    expect(result.nextState).toBe('AWAITING_PAYMENT');
    expect(result.nextContext).toEqual({ orderId: 'order-1' });
    expect(result.outboundMessages).toEqual([{ body: bankTransferInstructionsMessage(550_000) }]);
  });

  it('YES with COD creates the order and sends the COD confirmation, ending at IDLE', async () => {
    createOrderFromQuoteMock.mockResolvedValue({ id: 'order-2', grandTotalKobo: 300_000n });
    const codDraft = { ...completeDraft, bundleId: 'household' as const, paymentMethod: 'cod' as const };

    const result = await quoteHandler.handle(ctx(codDraft), 'yes');

    expect(result.nextState).toBe('IDLE');
    expect(result.nextContext).toEqual({});
    const window = getPickupWindowByMenuReply('2')!;
    expect(result.outboundMessages).toEqual([{ body: codConfirmationMessage(300_000, window.label) }]);
  });

  it('an incomplete order draft on YES does not attempt order creation and safely resets to IDLE', async () => {
    const incompleteDraft = { ...completeDraft, address: undefined };

    const result = await quoteHandler.handle(ctx(incompleteDraft), 'YES');

    expect(createOrderFromQuoteMock).not.toHaveBeenCalled();
    expect(result.nextState).toBe('IDLE');
  });
});
