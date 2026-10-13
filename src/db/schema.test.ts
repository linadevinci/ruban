import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso } from '@/db/ids';
import { db, openDatabase } from '@/db/schema';
import { enqueue } from '@/db/outbox';

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.dayLogs.clear(), db.weights.clear(), db.calorieEntries.clear(),
    db.runs.clear(), db.weekPlans.clear(), db.settings.clear(),
    db.cycles.clear(), db.outbox.clear(), db.meta.clear(),
  ]);
});

describe('newId', () => {
  it('produces distinct, time-sortable ids', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('nowIso', () => {
  it('produces a parseable ISO 8601 string', () => {
    expect(Number.isNaN(Date.parse(nowIso()))).toBe(false);
  });

  it('is strictly increasing, so two writes in one millisecond differ', () => {
    // Spec 7 applies an incoming change only where updatedAt is STRICTLY
    // newer. A repeated stamp means the second write is dropped server-side.
    const stamps = Array.from({ length: 500 }, () => nowIso());
    for (const stamp of stamps) {
      expect(Number.isNaN(Date.parse(stamp))).toBe(false);
    }
    const ties = stamps.filter((s, i) => i > 0 && Date.parse(s) <= Date.parse(stamps[i - 1] ?? ''));
    expect(ties).toEqual([]);
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});

describe('db schema', () => {
  it('stores and reads a day log by user and date', async () => {
    const id = newId();
    await db.dayLogs.put({
      id, userId: 'u1', updatedAt: nowIso(), deletedAt: null,
      date: '2026-10-06', ticks: { course: true }, steps: 8200, waterGlasses: 6,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    });
    const found = await db.dayLogs.where('[userId+date]').equals(['u1', '2026-10-06']).first();
    expect(found?.id).toBe(id);
    expect(found?.ticks.course).toBe(true);
  });

  it('rejects a second day log for the same user and date', async () => {
    // The compound index is unique, so two devices that each minted their own
    // id for one logical day fail loudly instead of splitting the row in two.
    const row = {
      userId: 'u1', updatedAt: nowIso(), deletedAt: null,
      date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    };
    await db.dayLogs.put({ ...row, id: newId() });
    await expect(db.dayLogs.put({ ...row, id: newId() })).rejects.toThrow(/Constraint/i);
    expect(await db.dayLogs.count()).toBe(1);
  });

  it('keeps one settings row per user', async () => {
    const base = {
      userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-06',
      startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
      weighInCadence: 'daily' as const, dailyCalorieTarget: 1500,
      noDinnerAllowance: 900, calorieFloor: 1200, stepTarget: 8000,
      waterTarget: 6, runSessionsTarget: 5, soundEnabled: false, updatedAt: nowIso(),
    };
    await db.settings.put(base);
    await db.settings.put({ ...base, stepTarget: 9000 });
    expect(await db.settings.count()).toBe(1);
    expect((await db.settings.get('u1'))?.stepTarget).toBe(9000);
  });

  it('stores meta values by key', async () => {
    await db.meta.put({ key: 'lastPulledAt', value: '2026-10-06T20:00:00Z' });
    expect((await db.meta.get('lastPulledAt'))?.value).toBe('2026-10-06T20:00:00Z');
  });
});

describe('enqueue', () => {
  it('appends outbox rows in call order', async () => {
    await enqueue('weights', 'put', { id: 'a' });
    await enqueue('runs', 'put', { id: 'b' });
    const rows = await db.outbox.orderBy('seq').toArray();
    expect(rows.map((r) => r.table)).toEqual(['weights', 'runs']);
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.op).toBe('put');
  });

  it('records a delete as a tombstone op rather than removing anything', async () => {
    const deletedAt = nowIso();
    await enqueue('runs', 'delete', { id: 'b', deletedAt });
    const row = await db.outbox.orderBy('seq').last();
    expect(row?.op).toBe('delete');
    expect(row?.table).toBe('runs');
    // Spec 7: a tombstone syncs like any other change, so the payload has to
    // carry the id and a non-null deletedAt or the server cannot apply it.
    const payload = row?.payload as { id?: string; deletedAt?: string | null } | undefined;
    expect(payload?.id).toBe('b');
    expect(payload?.deletedAt).toBe(deletedAt);
    expect(typeof payload?.deletedAt).toBe('string');
  });
});

describe('openDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a fresh database', async () => {
    // beforeEach has already opened it; close first so this is a real open.
    db.close();
    expect(await openDatabase()).toEqual({ ok: true });
    expect(db.isOpen()).toBe(true);
  });

  it.each(['SecurityError', 'QuotaExceededError', 'InvalidStateError'])(
    'reports %s as blocked, keeping the error',
    async (name) => {
      const error = new DOMException('denied', name);
      vi.spyOn(db, 'open').mockRejectedValue(error);
      const result = await openDatabase();
      expect(result).toMatchObject({ ok: false, reason: 'blocked' });
      if (!result.ok) expect(result.error).toBe(error);
    },
  );

  it('reports a plain Error as unknown, keeping the error', async () => {
    const error = new Error('boom');
    vi.spyOn(db, 'open').mockRejectedValue(error);
    const result = await openDatabase();
    expect(result).toMatchObject({ ok: false, reason: 'unknown' });
    if (!result.ok) expect(result.error).toBe(error);
  });

  it('does not throw when the rejection is not an Error at all', async () => {
    vi.spyOn(db, 'open').mockRejectedValue(null);
    await expect(openDatabase()).resolves.toEqual({
      ok: false, reason: 'unknown', error: null,
    });
  });
});
