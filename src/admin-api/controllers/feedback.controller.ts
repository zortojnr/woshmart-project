import type { Response } from 'express';
import { listFeedback } from '../../domain/feedback/feedback.service';
import type { AuthenticatedRequest } from '../middleware/auth.middleware';

// GET /admin/feedback — list feedback entries.
export async function list(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const feedback = await listFeedback();
  res.status(200).json({ feedback });
}
