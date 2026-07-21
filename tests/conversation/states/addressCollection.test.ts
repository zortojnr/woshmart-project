import { describe, expect, it } from 'vitest';
import { PICKUP_TIME_MESSAGE } from '../../../src/conversation/messages';
import { addressCollectionHandler } from '../../../src/conversation/states/addressCollection';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(context: Record<string, unknown> = { area: 'Maitumbi', bundleId: 'starter' }): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'ADDRESS_COLLECTION', context };
}

describe('addressCollectionHandler', () => {
  it('accepts any non-blank text as the address and advances to PICKUP_TIME', async () => {
    const result = await addressCollectionHandler.handle(ctx(), '12 Example Street, near the mosque');

    expect(result.nextState).toBe('PICKUP_TIME');
    expect(result.nextContext).toEqual({ area: 'Maitumbi', bundleId: 'starter', address: '12 Example Street, near the mosque' });
    expect(result.outboundMessages).toEqual([{ body: PICKUP_TIME_MESSAGE }]);
  });

  it('blank/whitespace-only input is treated as unmatched and re-prompts', async () => {
    const result = await addressCollectionHandler.handle(ctx(), '   ');

    expect(result.nextState).toBe('ADDRESS_COLLECTION');
    expect(result.nextContext.unmatchedCount).toBe(1);
    expect(result.outboundMessages[0]?.body).toMatch(/Starter Bundle/);
  });
});
