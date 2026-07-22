import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { prisma } from '../../src/db/client';
import { cleanupAdmin, createTestAdmin, TEST_ADMIN_PASSWORD } from './testHelpers';

const app = createApp();
const createdAdminIds: string[] = [];

afterAll(async () => {
  for (const id of createdAdminIds) {
    await cleanupAdmin(id);
  }
  await prisma.$disconnect();
});

describe('POST /admin/auth/login', () => {
  it('issues a JWT for valid credentials', async () => {
    const { admin } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);

    const res = await request(app).post('/admin/auth/login').send({ email: admin.email, password: TEST_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.admin).toMatchObject({ id: admin.id, email: admin.email, role: 'ops' });

    const payload = jwt.verify(res.body.token, env.JWT_SIGNING_SECRET) as jwt.JwtPayload;
    expect(payload.sub).toBe(admin.id);
    expect(payload.role).toBe('ops');
  });

  it('rejects an unknown email with 401', async () => {
    const res = await request(app)
      .post('/admin/auth/login')
      .send({ email: 'nobody@test.woshmart.local', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with 401', async () => {
    const { admin } = await createTestAdmin('viewer');
    createdAdminIds.push(admin.id);

    const res = await request(app).post('/admin/auth/login').send({ email: admin.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('rejects an inactive admin with 401 even with the correct password', async () => {
    const { admin } = await createTestAdmin('ops');
    createdAdminIds.push(admin.id);
    await prisma.admin.update({ where: { id: admin.id }, data: { active: false } });

    const res = await request(app).post('/admin/auth/login').send({ email: admin.email, password: TEST_ADMIN_PASSWORD });

    expect(res.status).toBe(401);
  });
});

describe('Admin API auth middleware', () => {
  it('rejects a request with no Authorization header with 401', async () => {
    const res = await request(app).get('/admin/orders');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed/garbage token with 401', async () => {
    const res = await request(app).get('/admin/orders').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    const expiredToken = jwt.sign({ role: 'viewer' }, env.JWT_SIGNING_SECRET, { subject: 'test-admin-id', expiresIn: -1 });
    const res = await request(app).get('/admin/orders').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret with 401', async () => {
    const forgedToken = jwt.sign({ role: 'super_admin' }, 'not-the-real-secret-at-all', {
      subject: 'test-admin-id',
      expiresIn: '8h',
    });
    const res = await request(app).get('/admin/orders').set('Authorization', `Bearer ${forgedToken}`);
    expect(res.status).toBe(401);
  });

  it('accepts a genuinely-issued, unexpired token', async () => {
    const { admin, token } = await createTestAdmin('viewer');
    createdAdminIds.push(admin.id);

    const res = await request(app).get('/admin/orders').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
