// Partner laundry directory logic.
import type { Partner } from '@prisma/client';
import { prisma } from '../../db/client';

export async function findPartnerByPhone(phoneNumber: string): Promise<Partner | null> {
  return prisma.partner.findUnique({ where: { phoneNumber } });
}

export async function listPartners(): Promise<Partner[]> {
  return prisma.partner.findMany({ orderBy: { name: 'asc' } });
}

export async function findPartnerById(id: string): Promise<Partner | null> {
  return prisma.partner.findUnique({ where: { id } });
}

export type PartnerStatus = 'active' | 'warning' | 'suspended';

export interface UpdatePartnerInput {
  name?: string | undefined;
  address?: string | undefined;
  contactName?: string | undefined;
  phoneNumber?: string | undefined;
  capacityPerDay?: number | undefined;
  canDoStarch?: boolean | undefined;
  canDoExpress?: boolean | undefined;
  status?: PartnerStatus | undefined;
}

// docs/TRD.md §5.2 PATCH /admin/partners/:id — "Update partner record".
export async function updatePartner(id: string, input: UpdatePartnerInput): Promise<Partner> {
  return prisma.partner.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.capacityPerDay !== undefined ? { capacityPerDay: input.capacityPerDay } : {}),
      ...(input.canDoStarch !== undefined ? { canDoStarch: input.canDoStarch } : {}),
      ...(input.canDoExpress !== undefined ? { canDoExpress: input.canDoExpress } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}
