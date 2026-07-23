// POST /admin/diagnostics/test-error (docs/BUILD_SCRIPT.md Phase 7 item 7): a
// deliberate test exception, used to verify Sentry capture end to end once
// SENTRY_DSN is configured. Also confirms it's genuinely restricted to super_admin,
// not just hidden in the Retool UI (CLAUDE.md Phase 5 scrutiny note extends to any new
// role-gated route).
//
// @sentry/node's exports aren't spy-able directly (vi.spyOn throws "Cannot redefine
// property"), so the module itself is mocked rather than spied on.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { cleanupAdmin, createTestAdmin } from './testHelpers';

const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }));
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: captureExceptionMock,
}));

const app = createApp();

describe('POST /admin/diagnostics/test-error', () => {
  let superAdminId: string;
  let superAdminToken: string;
  let opsId: string;
  let opsToken: string;

  beforeEach(async () => {
    ({ admin: { id: superAdminId }, token: superAdminToken } = await createTestAdmin('super_admin'));
    ({ admin: { id: opsId }, token: opsToken } = await createTestAdmin('ops'));
    captureExceptionMock.mockClear();
  });

  afterEach(async () => {
    await cleanupAdmin(superAdminId);
    await cleanupAdmin(opsId);
  });

  it('rejects an ops-role token with 403 — not just hidden in the UI', async () => {
    const res = await request(app)
      .post('/admin/diagnostics/test-error')
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(403);
  });

  it('a super_admin request deliberately throws, is captured by Sentry, and responds 500', async () => {
    const res = await request(app)
      .post('/admin/diagnostics/test-error')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect((captureExceptionMock.mock.calls[0]?.[0] as Error).message).toMatch(/deliberate test error/i);
  });
});
