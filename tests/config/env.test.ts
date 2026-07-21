import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runWithEnv(envOverrides: Record<string, string | undefined>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // Strip everything env.ts cares about so only the overrides below are present —
  // otherwise the real .env-derived process.env would mask a "missing var" scenario.
  for (const key of [
    'NODE_ENV',
    'PORT',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_WHATSAPP_NUMBER',
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SIGNING_SECRET',
    'BANK_NAME',
    'BANK_ACCOUNT_NUMBER',
    'SENTRY_DSN',
    'OBJECT_STORAGE_ACCESS_KEY_ID',
    'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_REGION',
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value !== undefined) env[key] = value;
  }

  return spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), path.join(__dirname, 'fixtures/load-env.ts')],
    {
      // cwd is the fixtures dir (no .env file there) so dotenv can't silently backfill
      // the vars this test is deliberately omitting from process.env.
      cwd: path.join(__dirname, 'fixtures'),
      env,
      encoding: 'utf-8',
    },
  );
}

const validEnv = {
  NODE_ENV: 'test',
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'test_auth_token',
  TWILIO_WHATSAPP_NUMBER: 'whatsapp:+15005550006',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SIGNING_SECRET: 'a'.repeat(32),
  BANK_NAME: 'Test Bank',
  BANK_ACCOUNT_NUMBER: '0000000000',
};

describe('config/env', () => {
  it('boots successfully when all required vars are present and valid', () => {
    const result = runWithEnv(validEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ENV_OK');
  });

  it('fails fast with a non-zero exit code when a required var is missing', () => {
    const { TWILIO_AUTH_TOKEN: _drop, ...rest } = validEnv;
    const result = runWithEnv(rest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FATAL: invalid environment configuration');
    expect(result.stderr).toContain('TWILIO_AUTH_TOKEN');
  });

  it('fails fast when DATABASE_URL is malformed', () => {
    const result = runWithEnv({ ...validEnv, DATABASE_URL: 'not-a-url' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });

  it('fails fast when JWT_SIGNING_SECRET is too short', () => {
    const result = runWithEnv({ ...validEnv, JWT_SIGNING_SECRET: 'short' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JWT_SIGNING_SECRET');
  });

  it('rejects a partially-configured object storage group', () => {
    const result = runWithEnv({ ...validEnv, OBJECT_STORAGE_BUCKET: 'some-bucket' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Partial object storage config');
  });
});
