import { describe, expect, it } from 'vitest';
import { PAYMENT_METHOD_MESSAGE, quoteMessageForBundle } from '../../../src/conversation/messages';
import { paymentMethodHandler } from '../../../src/conversation/states/paymentMethod';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(): SessionContext {
  return {
    phoneNumber: '+2348011111111',
    state: 'PAYMENT_METHOD',
    context: { area: 'Maitumbi', bundleId: 'family', address: '12 Example Street', pickupWindowId: '2' },
  };
}

describe('paymentMethodHandler', () => {
  it('reply "1" selects bank transfer, sends the exact quote, advances to QUOTE_PENDING', async () => {
    const result = await paymentMethodHandler.handle(ctx(), '1');

    expect(result.nextState).toBe('QUOTE_PENDING');
    expect(result.nextContext.paymentMethod).toBe('transfer');
    expect(result.outboundMessages).toEqual([{ body: quoteMessageForBundle('family') }]);
  });

  it('reply "2" selects COD, same quote either way', async () => {
    const result = await paymentMethodHandler.handle(ctx(), '2');

    expect(result.nextContext.paymentMethod).toBe('cod');
    expect(result.outboundMessages).toEqual([{ body: quoteMessageForBundle('family') }]);
  });

  it('an unrecognized reply re-prompts with the payment method menu', async () => {
    const result = await paymentMethodHandler.handle(ctx(), '3');

    expect(result.nextState).toBe('PAYMENT_METHOD');
    expect(result.outboundMessages).toEqual([{ body: PAYMENT_METHOD_MESSAGE }]);
  });
});
