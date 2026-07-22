import type { Response } from 'express';
import { z } from 'zod';
import { findUserById, flagUser, listUsers } from '../../domain/users/user.service';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// GET /admin/users — list customers.
export async function list(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const users = await listUsers();
  res.status(200).json({ users });
}

const flagSchema = z.object({
  accountStatus: z.enum(['active', 'flagged', 'blocked']).optional(),
  prepaymentRequired: z.boolean().optional(),
  notes: z.string().optional(),
});

// PATCH /admin/users/:id/flag — set account status / prepayment flag.
export async function flag(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = flagSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid flag payload');
  }

  const userId = req.params.id as string;
  const before = await findUserById(userId);
  if (!before) {
    throw new NotFoundError('User not found');
  }

  const updated = await flagUser(userId, parsed.data);

  await recordAudit(req, res, {
    action: 'user.flag',
    entityType: 'user',
    entityId: userId,
    before: { accountStatus: before.accountStatus, prepaymentRequired: before.prepaymentRequired, notes: before.notes },
    after: { accountStatus: updated.accountStatus, prepaymentRequired: updated.prepaymentRequired, notes: updated.notes },
  });
  res.status(200).json({ user: updated });
}
