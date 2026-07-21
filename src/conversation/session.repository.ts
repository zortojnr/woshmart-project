import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import type { ConversationState } from './types';

const INITIAL_STATE: ConversationState = 'WELCOME';

export interface SessionRecord {
  phoneNumber: string;
  state: ConversationState;
  context: Record<string, unknown>;
}

// Load-or-create by phone_number, atomically — concurrent inbound messages from the
// same number (e.g. a retried webhook) must not race to create two session rows.
export async function loadOrCreateSession(phoneNumber: string): Promise<SessionRecord> {
  const session = await prisma.session.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber, state: INITIAL_STATE, context: {} },
  });

  return {
    phoneNumber: session.phoneNumber,
    state: session.state as ConversationState,
    context: (session.context as Record<string, unknown> | null) ?? {},
  };
}

export async function saveSession(
  phoneNumber: string,
  state: ConversationState,
  context: Record<string, unknown>,
): Promise<void> {
  await prisma.session.update({
    where: { phoneNumber },
    data: { state, context: context as Prisma.InputJsonValue, lastMessageAt: new Date() },
  });
}
