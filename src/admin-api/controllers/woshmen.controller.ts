import type { Response } from 'express';
import { z } from 'zod';
import { findWoshmanById, listWoshmen, updateWoshman } from '../../domain/woshmen/woshman.service';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// GET /admin/woshmen — list Woshmen.
export async function list(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const woshmen = await listWoshmen();
  res.status(200).json({ woshmen });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional(),
  availability: z.enum(['available', 'on_job', 'off_duty']).optional(),
  active: z.boolean().optional(),
});

// PATCH /admin/woshmen/:id — update Woshman record.
export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid Woshman update payload');
  }

  const woshmanId = req.params.id as string;
  const before = await findWoshmanById(woshmanId);
  if (!before) {
    throw new NotFoundError('Woshman not found');
  }

  const updated = await updateWoshman(woshmanId, parsed.data);

  await recordAudit(req, res, {
    action: 'woshman.update',
    entityType: 'woshman',
    entityId: woshmanId,
    before,
    after: updated,
  });
  res.status(200).json({ woshman: updated });
}
