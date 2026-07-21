// Partner laundry directory logic. Only the sender-type lookup needed by the keyword
// protocol is implemented here (Phase 4) — full directory management is Phase 5 Admin
// API territory.
import type { Partner } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findPartnerByPhone(phoneNumber: string): Promise<Partner | null> {
  return prisma.partner.findUnique({ where: { phoneNumber } });
}
