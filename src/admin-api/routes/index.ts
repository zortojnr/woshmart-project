// Admin API route registration (docs/TRD.md §5.2). auth.middleware.ts + rbac.middleware.ts
// are wired on every route below except login (there's no token yet); audit.middleware.ts
// is wired once for the whole router so every write route is covered automatically
// (docs/BUILD_SCRIPT.md Phase 5 items 2-3 / CLAUDE.md rule 8).
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { login } from '../controllers/auth.controller';
import { list as listFeedback } from '../controllers/feedback.controller';
import { send as sendMessage } from '../controllers/messages.controller';
import { assign, detail, list as listOrders, updateStatus } from '../controllers/orders.controller';
import { list as listPartners, update as updatePartner } from '../controllers/partners.controller';
import { list as listPricing, update as updatePricing } from '../controllers/pricing.controller';
import { flag as flagUser, list as listUsers } from '../controllers/users.controller';
import { list as listWoshmen, update as updateWoshman } from '../controllers/woshmen.controller';
import { auditGuardMiddleware } from '../middleware/audit.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';

export const adminRouter = Router();

adminRouter.use(auditGuardMiddleware);

adminRouter.post('/auth/login', asyncHandler(login));

// Orders
adminRouter.get('/orders', authMiddleware, requireRole('viewer'), asyncHandler(listOrders));
adminRouter.get('/orders/:id', authMiddleware, requireRole('viewer'), asyncHandler(detail));
adminRouter.patch('/orders/:id/status', authMiddleware, requireRole('ops'), asyncHandler(updateStatus));
adminRouter.patch('/orders/:id/assign', authMiddleware, requireRole('ops'), asyncHandler(assign));

// Users
adminRouter.get('/users', authMiddleware, requireRole('viewer'), asyncHandler(listUsers));
adminRouter.patch('/users/:id/flag', authMiddleware, requireRole('ops'), asyncHandler(flagUser));

// Woshmen
adminRouter.get('/woshmen', authMiddleware, requireRole('viewer'), asyncHandler(listWoshmen));
adminRouter.patch('/woshmen/:id', authMiddleware, requireRole('ops'), asyncHandler(updateWoshman));

// Partners
adminRouter.get('/partners', authMiddleware, requireRole('viewer'), asyncHandler(listPartners));
adminRouter.patch('/partners/:id', authMiddleware, requireRole('ops'), asyncHandler(updatePartner));

// Pricing
adminRouter.get('/pricing', authMiddleware, requireRole('viewer'), asyncHandler(listPricing));
adminRouter.patch('/pricing', authMiddleware, requireRole('super_admin'), asyncHandler(updatePricing));

// Manual message send
adminRouter.post('/messages/send', authMiddleware, requireRole('ops'), asyncHandler(sendMessage));

// Feedback
adminRouter.get('/feedback', authMiddleware, requireRole('viewer'), asyncHandler(listFeedback));
