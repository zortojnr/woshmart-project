import { describe, expect, it } from 'vitest';
import { PAYMENT_METHOD_MESSAGE, PICKUP_TIME_MESSAGE } from '../../../src/conversation/messages';
import { pickupTimeHandler } from '../../../src/conversation/states/pickupTime';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(): SessionContext {
  return {
    phoneNumber: '+2348011111111',
    state: 'PICKUP_TIME',
    context: { area: 'Maitumbi', bundleId: 'starter', address: '12 Example Street' },
  };
}

describe('pickupTimeHandler', () => {
  it.each(['1', '2', '3', '4', '5'])('reply "%s" is a valid window, advances to PAYMENT_METHOD', async (reply) => {
    const result = await pickupTimeHandler.handle(ctx(), reply);

    expect(result.nextState).toBe('PAYMENT_METHOD');
    expect(result.nextContext.pickupWindowId).toBe(reply);
    expect(result.outboundMessages).toEqual([{ body: PAYMENT_METHOD_MESSAGE }]);
  });

  it('an out-of-range reply re-prompts with the pickup time menu', async () => {
    const result = await pickupTimeHandler.handle(ctx(), '6');

    expect(result.nextState).toBe('PICKUP_TIME');
    expect(result.outboundMessages).toEqual([{ body: PICKUP_TIME_MESSAGE }]);
  });
});
