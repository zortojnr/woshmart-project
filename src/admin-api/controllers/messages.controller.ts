import type { Response } from 'express';
import { z } from 'zod';
import { sendManualMessage } from '../../domain/notifications/notification.service';
import { findUserById } from '../../domain/users/user.service';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { recordAudit } from '../middleware/audit.middleware';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

const sendSchema = z.object({
  userId: z.string().uuid(),
  body: z.string().min(1),
});

// POST /admin/messages/send — manual one-off customer message. Routes through the
// Notification Service (never calls Twilio/the Messaging Service directly from here),
// per CLAUDE.md rule 5.
export async function send(req: AuthenticatedRequest, res: Response): Promise<void> {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BadRequestError('userId and body are required');
  }

  const { userId, body } = parsed.data;
  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  await sendManualMessage(user.phoneNumber, body);

  await recordAudit(req, res, {
    action: 'message.manual_send',
    entityType: 'user',
    entityId: userId,
    before: null,
    after: { body },
  });
  res.status(200).json({ sent: true });
}
