// Woshman directory logic. Only the sender-type lookup needed by the keyword protocol
// is implemented here (Phase 4) — full directory management is Phase 5 Admin API territory.
import type { Woshman } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findWoshmanByPhone(phoneNumber: string): Promise<Woshman | null> {
  return prisma.woshman.findUnique({ where: { phoneNumber } });
}
