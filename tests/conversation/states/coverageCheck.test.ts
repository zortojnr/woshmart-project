import { describe, expect, it } from 'vitest';
import { coverageConfirmedMessage, outOfCoverageMessage, WAITLIST_DECLINE_MESSAGE } from '../../../src/conversation/messages';
import { coverageCheckHandler } from '../../../src/conversation/states/coverageCheck';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(context: Record<string, unknown> = {}): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'COVERAGE_CHECK', context };
}

describe('coverageCheckHandler — first turn (area statement)', () => {
  it.each([
    ['Maitumbi', 'Maitumbi'],
    ['I live in bosso', 'Bosso'],
    ['new tunga please', 'Tunga'],
    ['near the Mobil filling station', 'Mobil area'],
  ])('in-zone area "%s" -> bundle menu, advances to SERVICE_SELECTION', async (input, canonical) => {
    const result = await coverageCheckHandler.handle(ctx(), input);

    expect(result.nextState).toBe('SERVICE_SELECTION');
    expect(result.outboundMessages).toEqual([{ body: coverageConfirmedMessage(canonical) }]);
    expect(result.nextContext).toEqual({ area: canonical });
  });

  it('waitlist-only zone (Kpakungu) -> out-of-coverage message, stays in COVERAGE_CHECK', async () => {
    const result = await coverageCheckHandler.handle(ctx(), 'Kpakungu');

    expect(result.nextState).toBe('COVERAGE_CHECK');
    expect(result.outboundMessages).toEqual([{ body: outOfCoverageMessage('Kpakungu') }]);
    expect(result.nextContext).toEqual({ awaitingWaitlistConfirmation: true, area: 'Kpakungu' });
  });

  it('not-yet-available zone (Chanchaga) -> out-of-coverage message', async () => {
    const result = await coverageCheckHandler.handle(ctx(), 'Chanchaga');

    expect(result.nextState).toBe('COVERAGE_CHECK');
    expect(result.outboundMessages).toEqual([{ body: outOfCoverageMessage('Chanchaga') }]);
  });

  it('unrecognized/malformed area input falls through to the out-of-coverage fallback without crashing', async () => {
    const result = await coverageCheckHandler.handle(ctx(), 'asdkfjasdkfj???');

    expect(result.nextState).toBe('COVERAGE_CHECK');
    expect(result.outboundMessages).toEqual([{ body: outOfCoverageMessage('asdkfjasdkfj???') }]);
    expect(result.nextContext).toEqual({ awaitingWaitlistConfirmation: true, area: 'asdkfjasdkfj???' });
  });
});

describe('coverageCheckHandler — second turn (waitlist YES/NO)', () => {
  it('YES logs a MARK_WAITLISTED side effect and ends at IDLE', async () => {
    const result = await coverageCheckHandler.handle(
      ctx({ awaitingWaitlistConfirmation: true, area: 'Kpakungu' }),
      'YES',
    );

    expect(result.nextState).toBe('IDLE');
    expect(result.outboundMessages).toEqual([]);
    expect(result.sideEffects).toEqual([{ type: 'MARK_WAITLISTED', payload: { area: 'Kpakungu' } }]);
    expect(result.nextContext).toEqual({});
  });

  it('case-insensitive "yes" is also accepted', async () => {
    const result = await coverageCheckHandler.handle(
      ctx({ awaitingWaitlistConfirmation: true, area: 'Kpakungu' }),
      'yes',
    );

    expect(result.sideEffects).toEqual([{ type: 'MARK_WAITLISTED', payload: { area: 'Kpakungu' } }]);
  });

  it('a non-YES reply declines with a short acknowledgement (never silence) and still ends at IDLE', async () => {
    const result = await coverageCheckHandler.handle(
      ctx({ awaitingWaitlistConfirmation: true, area: 'Kpakungu' }),
      'no thanks',
    );

    expect(result.nextState).toBe('IDLE');
    expect(result.outboundMessages).toEqual([{ body: WAITLIST_DECLINE_MESSAGE }]);
    expect(result.sideEffects).toBeUndefined();
  });
});
