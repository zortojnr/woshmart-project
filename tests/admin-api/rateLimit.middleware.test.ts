// Admin API rate-limit middleware wiring (docs/BUILD_SCRIPT.md Phase 7 item 1). Unlike
// the webhook limiters, a denied request here is a real 429 via next(err) — Retool and
// any other admin client are expected to see and back off from a normal HTTP error.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '../../src/lib/rateLimiter';
import { TooManyRequestsError } from '../../src/lib/errors';
import type { AuthenticatedRequest } from '../../src/admin-api/middleware/auth.middleware';
import type { adminRateLimit as AdminRateLimitFn, loginRateLimit as LoginRateLimitFn } from '../../src/admin-api/middleware/rateLimit.middleware';

vi.mock('../../src/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(),
}));

const checkRateLimitMock = vi.mocked(checkRateLimit);

let loginRateLimit: typeof LoginRateLimitFn;
let adminRateLimit: typeof AdminRateLimitFn;

beforeAll(async () => {
  ({ loginRateLimit, adminRateLimit } = await import('../../src/admin-api/middleware/rateLimit.middleware'));
});

function fakeReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return { ip: '203.0.113.1', ...overrides } as AuthenticatedRequest;
}

beforeEach(() => {
  checkRateLimitMock.mockReset();
});

describe('loginRateLimit', () => {
  it('calls next() with no error when under the limit', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 });
    const next = vi.fn();

    await loginRateLimit(fakeReq(), {} as never, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(TooManyRequestsError) when the IP-keyed limit is exceeded', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 900_000 });
    const next = vi.fn();

    await loginRateLimit(fakeReq(), {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(TooManyRequestsError);
  });

  it('fails open when the check itself throws', async () => {
    checkRateLimitMock.mockRejectedValueOnce(new Error('Redis unreachable'));
    const next = vi.fn();

    await loginRateLimit(fakeReq(), {} as never, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('adminRateLimit', () => {
  it('keys by admin id, not IP, when authenticated', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 });
    const next = vi.fn();

    await adminRateLimit(fakeReq({ admin: { id: 'admin-1', role: 'ops' } }), {} as never, next);

    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.stringContaining('admin-1'), expect.any(Number), expect.any(Number));
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(TooManyRequestsError) when the per-admin limit is exceeded', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 30_000 });
    const next = vi.fn();

    await adminRateLimit(fakeReq({ admin: { id: 'admin-1', role: 'ops' } }), {} as never, next);

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(TooManyRequestsError);
  });
});
