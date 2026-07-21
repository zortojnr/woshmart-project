import { describe, expect, it } from 'vitest';
import { addressRequestMessage, coverageConfirmedMessage } from '../../../src/conversation/messages';
import { serviceSelectionHandler } from '../../../src/conversation/states/serviceSelection';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(context: Record<string, unknown> = { area: 'Maitumbi' }): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'SERVICE_SELECTION', context };
}

describe('serviceSelectionHandler', () => {
  it.each([
    ['1', 'Starter Bundle', 200_000],
    ['2', 'Weekly Bundle', 380_000],
    ['3', 'Family Bundle', 550_000],
    ['4', 'Household Bundle', 300_000],
  ] as const)('reply "%s" selects %s and advances to ADDRESS_COLLECTION', async (reply, bundleName, priceKobo) => {
    const result = await serviceSelectionHandler.handle(ctx(), reply);

    expect(result.nextState).toBe('ADDRESS_COLLECTION');
    expect(result.outboundMessages).toEqual([{ body: addressRequestMessage(bundleName, priceKobo) }]);
    expect(result.nextContext.area).toBe('Maitumbi');
    expect(result.nextContext.bundleId).toBeDefined();
  });

  it('an out-of-range or non-numeric reply re-prompts with the bundle menu (unmatched input)', async () => {
    const result = await serviceSelectionHandler.handle(ctx(), '5');

    expect(result.nextState).toBe('SERVICE_SELECTION');
    expect(result.outboundMessages).toEqual([{ body: coverageConfirmedMessage('Maitumbi') }]);
    expect(result.nextContext.unmatchedCount).toBe(1);
  });

  it('escalates after 3 consecutive unmatched replies', async () => {
    let context: Record<string, unknown> = { area: 'Maitumbi' };
    for (let i = 0; i < 2; i++) {
      const result = await serviceSelectionHandler.handle(ctx(context), 'nonsense');
      context = result.nextContext;
    }
    const result = await serviceSelectionHandler.handle(ctx(context), 'nonsense');

    expect(result.nextContext.flaggedForCoo).toBe(true);
    expect(result.nextContext.unmatchedCount).toBe(0);
    expect(result.outboundMessages[0]?.body).toMatch(/menu/i);
  });
});
