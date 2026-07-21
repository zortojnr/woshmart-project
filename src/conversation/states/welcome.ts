import { WELCOME_MESSAGE } from '../messages';
import type { HandlerResult, StateHandler } from '../types';

// WELCOME has no input to parse — any first inbound message is the trigger.
// Sends the welcome copy and immediately advances to COVERAGE_CHECK.
export const welcomeHandler: StateHandler = {
  async handle(): Promise<HandlerResult> {
    return {
      nextState: 'COVERAGE_CHECK',
      nextContext: {},
      outboundMessages: [{ body: WELCOME_MESSAGE }],
    };
  },
};
