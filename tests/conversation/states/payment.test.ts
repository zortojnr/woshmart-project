import { describe, expect, it } from 'vitest';
import { awaitingPaymentHandler } from '../../../src/conversation/states/payment';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(context: Record<string, unknown> = { orderId: 'order-123' }): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'AWAITING_PAYMENT', context };
}

describe('awaitingPaymentHandler', () => {
  it('any inbound message holds the session — no state change, no outbound message', async () => {
    const result = await awaitingPaymentHandler.handle(ctx(), 'here is my receipt');

    expect(result.nextState).toBe('AWAITING_PAYMENT');
    expect(result.nextContext).toEqual({ orderId: 'order-123' });
    expect(result.outboundMessages).toEqual([]);
  });

  it('emits a RECEIPT_HELD side effect referencing the orderId, for future COO visibility', async () => {
    const result = await awaitingPaymentHandler.handle(ctx(), 'sent!');

    expect(result.sideEffects).toEqual([{ type: 'RECEIPT_HELD', payload: { orderId: 'order-123' } }]);
  });
});
