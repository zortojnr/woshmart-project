import type { Response } from 'express';
import { z } from 'zod';
import { findPricingConfigByKey, listPricingConfig, upsertPricingConfig } from '../../domain/pricing/pricing.service';
import { BadRequestError } from '../../lib/errors';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// GET /admin/pricing — current pricing config.
export async function list(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const pricing = await listPricingConfig();
  res.status(200).json({ pricing });
}

const updateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

// PATCH /admin/pricing — update pricing config. super_admin only (rbac.middleware.ts).
export async function update(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('key and value are required');
  }

  const { key, value } = parsed.data;
  const before = await findPricingConfigByKey(key);
  const updated = await upsertPricingConfig(key, value, req.admin!.id);

  await recordAudit(req, res, {
    action: 'pricing.update',
    entityType: 'pricing_config',
    entityId: key,
    before,
    after: updated,
  });
  res.status(200).json({ pricing: updated });
}
