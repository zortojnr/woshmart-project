// Captures before/after state on every write route into admin_actions, automatically
// (docs/BUILD_SCRIPT.md Phase 5 item 3 / CLAUDE.md rule 8).
//
// Only the controller knows what it actually just changed, so it calls `recordAudit()`
// itself, as the last thing it does before responding — that write is awaited, so the
// admin_actions row is guaranteed to exist by the time the response is sent (no
// fire-and-forget race between the HTTP response and the DB write landing).
//
// `auditGuardMiddleware` is the "automatic, no opt-out" half: mounted once on the admin
// router, it doesn't perform the write itself, but if a write route responds 2xx without
// ever having called recordAudit(), that's a gap in the trail — logged loudly as an
// error rather than silently missing, since an audit log with gaps is worse than none.
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/client';
import { logger } from '../../lib/logger';
import type { AuthenticatedRequest } from './auth.middleware';

export interface AuditContext {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function serializeForAudit(value: unknown): Prisma.InputJsonValue | typeof PrismaNamespace.JsonNull {
  if (value === undefined || value === null) return PrismaNamespace.JsonNull;
  // BigInt (money columns) doesn't survive JSON.stringify by default — render it as a
  // string in the audit trail rather than throwing on every order-touching write.
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

export async function recordAudit(req: Request, res: Response, context: AuditContext): Promise<void> {
  res.locals.auditRecorded = true;

  const admin = (req as AuthenticatedRequest).admin;
  if (!admin) {
    logger.error({ path: req.path, action: context.action }, 'recordAudit called with no authenticated admin on the request');
    return;
  }

  try {
    await prisma.adminAction.create({
      data: {
        adminId: admin.id,
        action: context.action,
        entityType: context.entityType,
        entityId: context.entityId ?? null,
        beforeValue: serializeForAudit(context.before),
        afterValue: serializeForAudit(context.after),
        ipAddress: req.ip ?? null,
      },
    });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, action: context.action, entityType: context.entityType },
      'Failed to write admin_actions audit row',
    );
  }
}

export function auditGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  res.on('finish', () => {
    const admin = (req as AuthenticatedRequest).admin;
    if (!admin) return; // POST /admin/auth/login — no admin to attribute an audit row to
    if (res.statusCode < 200 || res.statusCode >= 300) return; // write didn't succeed
    if (res.locals.auditRecorded) return;

    logger.error(
      { path: req.path, method: req.method, adminId: admin.id },
      'Write route completed with no audit record — admin_actions row NOT written',
    );
  });

  next();
}
