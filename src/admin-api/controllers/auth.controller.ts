// POST /admin/auth/login — the one Admin API route with no auth/rbac/audit middleware
// (there's no token yet, and no admin to attribute an audit row to).
import type { Request, Response } from 'express';
import { z } from 'zod';
import { findAdminByEmail, recordLogin, verifyPassword } from '../../domain/admins/admin.service';
import { UnauthorizedError } from '../../lib/errors';
import { issueAdminToken } from '../auth/token';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function login(req: Request, res: Response): Promise<void> {
  // TEMPORARY debug logging -- diagnosing a production "Invalid email or password"
  // login failure that persisted after confirming (via direct DB checks) that the
  // account exists, is active, has the right role, and the password hash matches.
  // Placed before the Zod parse deliberately: a malformed request body would fail
  // parsing and hit the same generic error below, indistinguishable from a real
  // wrong-password case -- this is the one thing a DB-side check can never catch.
  // Logs shape/lengths only, never the actual email or password value. Remove once
  // the login issue is diagnosed -- not meant to stay in the codebase.
  console.log('[LOGIN DEBUG] content-type:', req.headers['content-type']);
  console.log('[LOGIN DEBUG] content-length:', req.headers['content-length']);
  console.log('[LOGIN DEBUG] body keys:', req.body && typeof req.body === 'object' ? Object.keys(req.body) : typeof req.body);
  console.log('[LOGIN DEBUG] body summary:', {
    emailType: typeof req.body?.email,
    emailLength: req.body?.email?.length,
    passwordType: typeof req.body?.password,
    passwordLength: req.body?.password?.length,
  });

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const { email, password } = parsed.data;
  const admin = await findAdminByEmail(email);

  // Same error/status for "no such admin" and "wrong password" — distinguishing them in
  // the response would let an attacker enumerate valid admin emails.
  if (!admin || !admin.active || !(await verifyPassword(admin, password))) {
    throw new UnauthorizedError('Invalid email or password');
  }

  await recordLogin(admin.id);
  const token = issueAdminToken(admin.id, admin.role as 'viewer' | 'ops' | 'super_admin');

  res.status(200).json({
    token,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  });
}
