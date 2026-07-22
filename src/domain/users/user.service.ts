// User/customer domain logic.
import type { User } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findOrCreateUserByPhone(phoneNumber: string): Promise<User> {
  return prisma.user.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber },
  });
}

// docs/TRD.md §5.2 GET /admin/users — no filters specified beyond "list", newest first.
export async function listUsers(): Promise<User[]> {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export type AccountStatus = 'active' | 'flagged' | 'blocked';

export interface FlagUserInput {
  accountStatus?: AccountStatus | undefined;
  prepaymentRequired?: boolean | undefined;
  notes?: string | undefined;
}

// docs/TRD.md §5.2 PATCH /admin/users/:id/flag — "Set account status / prepayment flag".
export async function flagUser(id: string, input: FlagUserInput): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      ...(input.accountStatus !== undefined ? { accountStatus: input.accountStatus } : {}),
      ...(input.prepaymentRequired !== undefined ? { prepaymentRequired: input.prepaymentRequired } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}
