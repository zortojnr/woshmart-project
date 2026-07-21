import { describe, expect, it } from 'vitest';
import { WELCOME_MESSAGE } from '../../../src/conversation/messages';
import { welcomeHandler } from '../../../src/conversation/states/welcome';
import type { SessionContext } from '../../../src/conversation/types';

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'WELCOME', context: {}, ...overrides };
}

describe('welcomeHandler', () => {
  it('sends the exact welcome copy and advances to COVERAGE_CHECK, regardless of input', async () => {
    const result = await welcomeHandler.handle(ctx(), 'anything at all');

    expect(result.nextState).toBe('COVERAGE_CHECK');
    expect(result.outboundMessages).toEqual([{ body: WELCOME_MESSAGE }]);
    expect(result.nextContext).toEqual({});
  });

  it('behaves the same for empty input (e.g. a blank first message)', async () => {
    const result = await welcomeHandler.handle(ctx(), '');

    expect(result.nextState).toBe('COVERAGE_CHECK');
    expect(result.outboundMessages).toEqual([{ body: WELCOME_MESSAGE }]);
  });
});
