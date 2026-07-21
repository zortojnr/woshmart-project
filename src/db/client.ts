import { PrismaClient } from '@prisma/client';

// Singleton Prisma client. Schema source of truth is the root-level prisma/schema.prisma
// (matches docs/DATABASE_SCHEMA.md) — see note in the Phase 0 PR re: ARCHITECTURE.md §4
// showing src/db/prisma/schema.prisma; the working root-level schema is what's real.
export const prisma = new PrismaClient();
