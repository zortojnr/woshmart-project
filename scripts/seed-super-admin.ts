// Seeds the first super_admin account. Deliberately a script, not a public endpoint —
// there is no admin signup route anywhere in the Admin API (docs/BUILD_SCRIPT.md Phase 5
// item 1). Run once per environment:
//   npx tsx scripts/seed-super-admin.ts <email> <name>
// Prompts for the password via stdin rather than accepting it as an argv/env value, so
// it never ends up in shell history or a process list.
import { createInterface } from 'node:readline';
import { prisma } from '../src/db/client';
import { hashPassword } from '../src/domain/admins/admin.service';

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
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npx tsx scripts/seed-super-admin.ts <email> <name>');
    process.exit(1);
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.error(`An admin with email "${email}" already exists (id: ${existing.id}). Not overwriting.`);
    process.exit(1);
  }

  const password = await readPasswordFromStdin('Password for the new super_admin: ');
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.admin.create({
    data: { email, name, passwordHash, role: 'super_admin' },
  });

  console.log(`Created super_admin ${admin.email} (id: ${admin.id}).`);
}

main()
  .catch((err) => {
    console.error('Failed to seed super_admin:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
