import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso } from '@/db/ids';
import { db } from '@/db/schema';
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
    await enqueue('runs', 'delete', { id: 'b', deletedAt: nowIso() });
    const row = await db.outbox.orderBy('seq').last();
    expect(row?.op).toBe('delete');
  });
});
