import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { checkHealth } from '../../src/lib/health';
import { redis } from '../../src/lib/redisClient';

const app = createApp();

describe('checkHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ok when DB and Redis are both reachable', async () => {
    const status = await checkHealth();
    expect(status).toEqual({ ok: true, db: 'up', redis: 'up' });
  });

  it('reports db down when the DB query throws, without affecting the redis check', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));

    const status = await checkHealth();
    expect(status.ok).toBe(false);
    expect(status.db).toBe('down');
    expect(status.redis).toBe('up');
  });

  it('reports redis down when ping fails', async () => {
    vi.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const status = await checkHealth();
    expect(status.ok).toBe(false);
    expect(status.redis).toBe('down');
    expect(status.db).toBe('up');
  });

  it('reports redis down when ping returns something other than PONG', async () => {
    vi.spyOn(redis, 'ping').mockResolvedValueOnce('WRONG' as never);

    const status = await checkHealth();
    expect(status.redis).toBe('down');
  });
});

describe('GET /health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when everything is up', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 503 when the DB is down', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
  });
});
