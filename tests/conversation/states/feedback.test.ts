import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_PROMPT_MESSAGE, FEEDBACK_RESPONSE_MESSAGES } from '../../../src/conversation/messages';
import { feedbackHandler } from '../../../src/conversation/states/feedback';
import type { SessionContext } from '../../../src/conversation/types';

const recordFeedbackMock = vi.fn();
vi.mock('../../../src/domain/orders/order.service', () => ({
  recordFeedback: (...args: unknown[]) => recordFeedbackMock(...args),
}));

function ctx(context: Record<string, unknown> = { orderId: 'order-1' }): SessionContext {
  return { phoneNumber: '+2348011111111', state: 'FEEDBACK_PENDING', context };
}

beforeEach(() => {
  recordFeedbackMock.mockReset();
});

describe('feedbackHandler', () => {
  it.each([1, 2, 3] as const)('score %i is recorded and gets the matching PRD response, ending at IDLE', async (score) => {
    const result = await feedbackHandler.handle(ctx(), String(score));

    expect(recordFeedbackMock).toHaveBeenCalledWith('order-1', score);
    expect(result.nextState).toBe('IDLE');
    expect(result.nextContext).toEqual({});
    expect(result.outboundMessages).toEqual([{ body: FEEDBACK_RESPONSE_MESSAGES[score] }]);
  });

  it('an unrecognized reply re-prompts with the feedback question', async () => {
    const result = await feedbackHandler.handle(ctx(), 'huh');

    expect(recordFeedbackMock).not.toHaveBeenCalled();
    expect(result.nextState).toBe('FEEDBACK_PENDING');
    expect(result.outboundMessages).toEqual([{ body: FEEDBACK_PROMPT_MESSAGE }]);
  });

  it('missing orderId in context safely resets to IDLE without crashing or recording feedback', async () => {
    const result = await feedbackHandler.handle(ctx({}), '1');

    expect(recordFeedbackMock).not.toHaveBeenCalled();
    expect(result.nextState).toBe('IDLE');
  });
});
