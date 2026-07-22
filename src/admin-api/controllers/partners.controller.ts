import type { Response } from 'express';
import { z } from 'zod';
import { findPartnerById, listPartners, updatePartner } from '../../domain/partners/partner.service';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// GET /admin/partners — list partners.
export async function list(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const partners = await listPartners();
  res.status(200).json({ partners });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  contactName: z.string().optional(),
  phoneNumber: z.string().min(1).optional(),
  capacityPerDay: z.number().int().positive().optional(),
  canDoStarch: z.boolean().optional(),
  canDoExpress: z.boolean().optional(),
  status: z.enum(['active', 'warning', 'suspended']).optional(),
});

// PATCH /admin/partners/:id — update partner record.
export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid partner update payload');
  }

  const partnerId = req.params.id as string;
  const before = await findPartnerById(partnerId);
  if (!before) {
    throw new NotFoundError('Partner not found');
  }

  const updated = await updatePartner(partnerId, parsed.data);

  await recordAudit(req, res, {
    action: 'partner.update',
    entityType: 'partner',
    entityId: partnerId,
    before,
    after: updated,
  });
  res.status(200).json({ partner: updated });
}
