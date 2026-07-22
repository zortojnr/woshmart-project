import { randomUUID } from 'node:crypto';
import { issueAdminToken } from '../../src/admin-api/auth/token';
import { prisma } from '../../src/db/client';
import { hashPassword, type AdminRole } from '../../src/domain/admins/admin.service';

export const TEST_ADMIN_PASSWORD = 'Test-Password-123!';

export async function createTestAdmin(role: AdminRole) {
  const email = `admin-test-${role}-${Date.now()}-${randomUUID().slice(0, 8)}@test.woshmart.local`;
  const passwordHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const admin = await prisma.admin.create({ data: { email, name: `Test ${role}`, role, passwordHash } });
  const token = issueAdminToken(admin.id, role);
  return { admin, token };
}

export async function cleanupAdmin(adminId: string): Promise<void> {
  await prisma.adminAction.deleteMany({ where: { adminId } });
  await prisma.admin.delete({ where: { id: adminId } });
}
