// User/customer domain logic. Only the minimum needed by order creation is implemented
// here (Phase 3) — flagging/blocking, profile edits, etc. are Phase 5 Admin API territory.
import type { User } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findOrCreateUserByPhone(phoneNumber: string): Promise<User> {
  return prisma.user.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber },
  });
}
