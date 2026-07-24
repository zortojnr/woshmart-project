// Webhook rate-limit middleware wiring (docs/BUILD_SCRIPT.md Phase 7 item 1). Unit-
// tested against a mocked checkRateLimit rather than driving real Redis up to the
// actual PHONE_LIMIT/GLOBAL_LIMIT thresholds (20/300 requests) — that would mean
// dozens of real signed HTTP round trips per test. The core counter itself is already
// covered against real Redis in tests/lib/rateLimiter.test.ts; this file is about the
// middleware's response behavior (short-circuit vs next(), and fail-open on error).
import type { NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '../../src/lib/rateLimiter';
import type { webhookGlobalRateLimit as WebhookGlobalRateLimitFn, webhookPhoneRateLimit as WebhookPhoneRateLimitFn } from '../../src/webhooks/rateLimit.middleware';

vi.mock('../../src/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(),
}));

const checkRateLimitMock = vi.mocked(checkRateLimit);

let webhookPhoneRateLimit: typeof WebhookPhoneRateLimitFn;
let webhookGlobalRateLimit: typeof WebhookGlobalRateLimitFn;

beforeAll(async () => {
  ({ webhookPhoneRateLimit, webhookGlobalRateLimit } = await import('../../src/webhooks/rateLimit.middleware'));
});

function fakeReqRes(body: Record<string, unknown> = {}) {
  const req = { body } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  checkRateLimitMock.mockReset();
});

describe('webhookPhoneRateLimit', () => {
  it('calls next() when under the limit', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 });
    const { req, res, next } = fakeReqRes({ From: 'whatsapp:+2348011111111' });

    await webhookPhoneRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('short-circuits with 200 + empty TwiML (not a 4xx) when over the limit', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 5000 });
    const { req, res, next } = fakeReqRes({ From: 'whatsapp:+2348011111111' });

    await webhookPhoneRateLimit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<Response>'));
  });

  it('fails open (calls next()) when the rate limit check itself throws', async () => {
    checkRateLimitMock.mockRejectedValueOnce(new Error('Redis unreachable'));
    const { req, res, next } = fakeReqRes({ From: 'whatsapp:+2348011111111' });

    await webhookPhoneRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() without checking when From is missing (lets Zod validation reject it)', async () => {
    const { req, res, next } = fakeReqRes({});

    await webhookPhoneRateLimit(req, res, next);

    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('webhookGlobalRateLimit', () => {
  it('calls next() when under the limit', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 });
    const { req, res, next } = fakeReqRes();

    await webhookGlobalRateLimit('inbound')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with 200 + empty TwiML when the global backstop trips', async () => {
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 5000 });
    const { req, res, next } = fakeReqRes();

    await webhookGlobalRateLimit('inbound')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
