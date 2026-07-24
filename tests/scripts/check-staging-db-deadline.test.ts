// getEffectiveCreatedAt is what the whole self-updating deadline reminder depends on
// (docs/SECURITY.md §3.9) — if it silently returned a wrong date instead of failing
// loudly on a brand-new/not-yet-migrated database, the reminder could go silent at
// exactly the wrong time. Confirmed manually against real scratch databases first
// (both "table doesn't exist" and "table exists, zero rows"); this test locks that
// behavior in so it can't regress unnoticed.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { daysBetween as DaysBetweenFn, getEffectiveCreatedAt as GetEffectiveCreatedAtFn } from '../../scripts/check-staging-db-deadline';

const queryRawMock = vi.fn();
const disconnectMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $queryRaw: queryRawMock,
    $disconnect: disconnectMock,
  })),
}));

let getEffectiveCreatedAt: typeof GetEffectiveCreatedAtFn;
let daysBetween: typeof DaysBetweenFn;

beforeAll(async () => {
  ({ getEffectiveCreatedAt, daysBetween } = await import('../../scripts/check-staging-db-deadline'));
});

beforeEach(() => {
  queryRawMock.mockReset();
  disconnectMock.mockClear();
});

describe('getEffectiveCreatedAt', () => {
  it('returns the earliest migration timestamp on the happy path', async () => {
    const createdAt = new Date('2026-07-20T15:19:46.905Z');
    queryRawMock.mockResolvedValueOnce([{ created_at: createdAt }]);

    const result = await getEffectiveCreatedAt('postgresql://fake');

    expect(result).toEqual(createdAt);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error (not a silent wrong date) when the table exists but has zero rows', async () => {
    // Confirmed against a real empty table: MIN() over zero rows returns exactly
    // this shape — one row with created_at: null, not an empty array.
    queryRawMock.mockResolvedValueOnce([{ created_at: null }]);

    await expect(getEffectiveCreatedAt('postgresql://fake')).rejects.toThrow(/_prisma_migrations has no rows/i);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('propagates the error (not a silent wrong date) when the table does not exist at all', async () => {
    // Confirmed against a real brand-new database: the raw query itself throws
    // `relation "_prisma_migrations" does not exist` rather than returning rows.
    queryRawMock.mockRejectedValueOnce(new Error('Raw query failed. Code: `42P01`. Message: `relation "_prisma_migrations" does not exist`'));

    await expect(getEffectiveCreatedAt('postgresql://fake')).rejects.toThrow(/does not exist/i);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('still disconnects even when the query throws (no leaked connection)', async () => {
    queryRawMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(getEffectiveCreatedAt('postgresql://fake')).rejects.toThrow();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});

describe('daysBetween', () => {
  it('computes whole days elapsed, rounding down', () => {
    const from = new Date('2026-07-24T12:00:00Z');
    const to = new Date('2026-08-21T11:59:00Z'); // 27 days and 23h59m later
    expect(daysBetween(from, to)).toBe(27);
  });

  it('returns 0 for the same instant', () => {
    const now = new Date('2026-07-24T00:00:00Z');
    expect(daysBetween(now, now)).toBe(0);
  });
});
