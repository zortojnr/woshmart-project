// JWT issuance for the Admin API. Verification lives in middleware/auth.middleware.ts —
// kept in a separate file so signing (login only) and verifying (every request) don't
// share a module that pulls in more than each needs.
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { AdminRole } from '../../domain/admins/admin.service';

// docs/BUILD_SCRIPT.md Phase 5: "short-lived JWT (~8hr)".
const ADMIN_TOKEN_TTL = '8h';

export interface AdminTokenPayload {
  sub: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

export function issueAdminToken(adminId: string, role: AdminRole): string {
  return jwt.sign({ role }, env.JWT_SIGNING_SECRET, {
    subject: adminId,
    expiresIn: ADMIN_TOKEN_TTL,
  });
}
