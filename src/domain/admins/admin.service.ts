// Admin (Retool-facing user) domain logic. Password hashing and lookup only — issuing
// the JWT itself lives in admin-api/auth/token.ts (keeps the signing secret/library
// import out of the domain layer, matching the service/handler split elsewhere).
import type { Admin } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/client';

const BCRYPT_COST_FACTOR = 12;

export type AdminRole = 'viewer' | 'ops' | 'super_admin';

export async function findAdminByEmail(email: string): Promise<Admin | null> {
  return prisma.admin.findUnique({ where: { email } });
}

export async function verifyPassword(admin: Admin, password: string): Promise<boolean> {
  return bcrypt.compare(password, admin.passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

export async function recordLogin(adminId: string): Promise<void> {
  await prisma.admin.update({ where: { id: adminId }, data: { lastLoginAt: new Date() } });
}
