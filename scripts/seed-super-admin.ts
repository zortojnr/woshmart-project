// Seeds an admin account. Deliberately a script, not a public endpoint — there is no
// admin signup route anywhere in the Admin API (docs/BUILD_SCRIPT.md Phase 5 item 1),
// so this is the only way any admin account (including the first super_admin) gets
// created. Run once per environment for the first super_admin; run again with a
// different role to create test accounts for RBAC verification (viewer/ops).
//   npx tsx scripts/seed-super-admin.ts <email> <name> [role]
// [role] defaults to super_admin if omitted — valid values: super_admin, ops, viewer.
// Prompts for the password via stdin rather than accepting it as an argv/env value, so
// it never ends up in shell history or a process list.
import { createInterface } from 'node:readline';
import { prisma } from '../src/db/client';
import { hashPassword, type AdminRole } from '../src/domain/admins/admin.service';

const VALID_ROLES: AdminRole[] = ['super_admin', 'ops', 'viewer'];

function readPasswordFromStdin(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [email, name, role = 'super_admin'] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npx tsx scripts/seed-super-admin.ts <email> <name> [role]');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role as AdminRole)) {
    console.error(`Unknown role "${role}". Valid options: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.error(`An admin with email "${email}" already exists (id: ${existing.id}). Not overwriting.`);
    process.exit(1);
  }

  const password = await readPasswordFromStdin(`Password for the new ${role}: `);
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.admin.create({
    data: { email, name, passwordHash, role },
  });

  console.log(`Created ${admin.role} ${admin.email} (id: ${admin.id}).`);
}

main()
  .catch((err) => {
    console.error('Failed to seed super_admin:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
