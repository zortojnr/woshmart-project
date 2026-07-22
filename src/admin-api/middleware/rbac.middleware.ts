// Checks the route's required role against the token's role (docs/TRD.md §5.2 min-role
// column). Ranked so a higher-privilege role satisfies a lower-privilege requirement —
// super_admin can do anything ops or viewer can. Must run after auth.middleware.ts,
// which is what actually populates req.admin.
import type { NextFunction, Response } from 'express';
import type { AdminRole } from '../../domain/admins/admin.service';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors';
import type { AuthenticatedRequest } from './auth.middleware';

const ROLE_RANK: Record<AdminRole, number> = {
  viewer: 0,
  ops: 1,
  super_admin: 2,
};

export function requireRole(minRole: AdminRole) {
  return function rbacMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    if (!req.admin) {
      next(new UnauthorizedError('Not authenticated'));
      return;
    }

    if (ROLE_RANK[req.admin.role] < ROLE_RANK[minRole]) {
      next(new ForbiddenError(`This action requires role "${minRole}" or higher`));
      return;
    }

    next();
  };
}
