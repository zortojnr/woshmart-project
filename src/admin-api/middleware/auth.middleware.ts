// Verifies JWT signature and expiry on every admin route (docs/BUILD_SCRIPT.md Phase 5
// item 2). Wired on the FIRST admin route, not retrofitted later. jwt.verify() checks
// both signature and `exp` in one call — an expired or tampered token throws and is
// rejected the same way (401), never silently accepted.
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { AdminRole } from '../../domain/admins/admin.service';
import { UnauthorizedError } from '../../lib/errors';
import type { AdminTokenPayload } from '../auth/token';

export interface AuthenticatedRequest extends Request {
  admin?: { id: string; role: AdminRole };
}

function isAdminTokenPayload(payload: unknown): payload is AdminTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { sub?: unknown }).sub === 'string' &&
    typeof (payload as { role?: unknown }).role === 'string'
  );
}

export function authMiddleware(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice('Bearer '.length);
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.JWT_SIGNING_SECRET);
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
    return;
  }

  if (!isAdminTokenPayload(payload)) {
    next(new UnauthorizedError('Invalid token payload'));
    return;
  }

  req.admin = { id: payload.sub, role: payload.role };
  next();
}
