// Feedback domain logic. Feedback rows are created in order.service.ts's
// recordFeedback() (Phase 3) — this file adds the Admin API's read-only listing.
import type { Feedback } from '@prisma/client';
import { prisma } from '../../db/client';

// docs/TRD.md §5.2 GET /admin/feedback — list feedback entries.
export async function listFeedback(): Promise<Feedback[]> {
  return prisma.feedback.findMany({
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { orderNumber: true, userId: true } } },
  });
}
