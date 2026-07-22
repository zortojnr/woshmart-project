// Woshman directory logic.
import type { Woshman } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findWoshmanByPhone(phoneNumber: string): Promise<Woshman | null> {
  return prisma.woshman.findUnique({ where: { phoneNumber } });
}

export async function listWoshmen(): Promise<Woshman[]> {
  return prisma.woshman.findMany({ orderBy: { joinedAt: 'desc' } });
}

export async function findWoshmanById(id: string): Promise<Woshman | null> {
  return prisma.woshman.findUnique({ where: { id } });
}

export type WoshmanAvailability = 'available' | 'on_job' | 'off_duty';

export interface UpdateWoshmanInput {
  name?: string | undefined;
  phoneNumber?: string | undefined;
  availability?: WoshmanAvailability | undefined;
  active?: boolean | undefined;
}

// docs/TRD.md §5.2 PATCH /admin/woshmen/:id — "Update Woshman record".
export async function updateWoshman(id: string, input: UpdateWoshmanInput): Promise<Woshman> {
  return prisma.woshman.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.availability !== undefined ? { availability: input.availability } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}
