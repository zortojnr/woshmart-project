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
