// FSM types per docs/TRD.md §2. Kept alongside engine.ts since state handlers,
// the engine, and the session repository all share this shape.

export type ConversationState =
  | 'WELCOME'
  | 'COVERAGE_CHECK'
  | 'SERVICE_SELECTION'
  | 'ADDRESS_COLLECTION'
  | 'PICKUP_TIME'
  | 'PAYMENT_METHOD'
  | 'QUOTE_PENDING'
  | 'AWAITING_PAYMENT'
  | 'FEEDBACK_PENDING'
  | 'IDLE';

export interface SessionContext {
  phoneNumber: string;
  state: ConversationState;
  context: Record<string, unknown>;
}

export interface OutboundMessage {
  body: string;
}

export interface SideEffect {
  type: string;
  payload?: Record<string, unknown>;
}

export interface HandlerResult {
  nextState: ConversationState;
  nextContext: Record<string, unknown>;
  outboundMessages: OutboundMessage[];
  sideEffects?: SideEffect[];
}

export interface StateHandler {
  handle(ctx: SessionContext, input: string): Promise<HandlerResult>;
}
