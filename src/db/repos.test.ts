import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import {
  getOrCreateDayLog, getOrCreateWeekPlan, listCycles, listRuns, listWeights,
  saveCycle, saveRun, saveWeight, softDelete, updateDayLog,
} from '@/db/repos';
import { DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS } from '@/domain/types';

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.dayLogs.clear(), db.weights.clear(), db.runs.clear(),
    db.weekPlans.clear(), db.calorieEntries.clear(), db.settings.clear(),
    db.cycles.clear(), db.outbox.clear(),
  ]);
});

describe('saveWeight', () => {
  it('stamps updatedAt and enqueues one outbox row', async () => {
    const saved = await saveWeight('u1', '2026-10-06', 62.4);
    expect(saved.kg).toBe(62.4);
    expect(saved.deletedAt).toBeNull();
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
    expect(await db.outbox.count()).toBe(1);
  });

  it('replaces the existing weigh-in for that date rather than adding a second', async () => {
    const first = await saveWeight('u1', '2026-10-06', 62.4);
    const second = await saveWeight('u1', '2026-10-06', 62.1);
    expect(second.id).toBe(first.id);
    expect(await listWeights('u1')).toHaveLength(1);
    expect((await listWeights('u1'))[0]?.kg).toBe(62.1);
  });
});

describe('saveRun', () => {
  it('allows two runs on one date', async () => {
    await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await saveRun('u1', { date: '2026-10-06', distanceKm: 3, durationS: 900, note: null });
    expect(await listRuns('u1')).toHaveLength(2);
  });
});

describe('softDelete', () => {
  it('tombstones instead of removing, and hides the row from lists', async () => {
    const run = await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await softDelete('runs', run.id);
    expect(await db.runs.get(run.id)).toBeDefined();
    expect((await db.runs.get(run.id))?.deletedAt).not.toBeNull();
    expect(await listRuns('u1')).toHaveLength(0);
  });

  it('enqueues a delete op', async () => {
    const run = await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    await db.outbox.clear();
    await softDelete('runs', run.id);
    expect((await db.outbox.orderBy('seq').last())?.op).toBe('delete');
  });
});

describe('getOrCreateDayLog', () => {
  it('creates once then returns the same row', async () => {
    const a = await getOrCreateDayLog('u1', '2026-10-06');
    const b = await getOrCreateDayLog('u1', '2026-10-06');
    expect(b.id).toBe(a.id);
    expect(await db.dayLogs.count()).toBe(1);
  });

  it('starts with nothing ticked and no stamps', async () => {
    const log = await getOrCreateDayLog('u1', '2026-10-06');
    expect(log.ticks).toEqual({});
    expect(log.validatedAt).toBeNull();
    expect(log.bonusFiredAt).toBeNull();
    expect(log.jokered).toBe(false);
  });
});

describe('updateDayLog', () => {
  it('merges a patch and bumps updatedAt', async () => {
    const created = await getOrCreateDayLog('u1', '2026-10-06');
    const patched = await updateDayLog('u1', '2026-10-06', { steps: 8200 });
    expect(patched.id).toBe(created.id);
    expect(patched.steps).toBe(8200);
    expect(Date.parse(patched.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('merges ticks rather than replacing the whole map', async () => {
    await updateDayLog('u1', '2026-10-06', { ticks: { course: true } });
    const after = await updateDayLog('u1', '2026-10-06', { ticks: { no_dinner: true } });
    expect(after.ticks).toEqual({ course: true, no_dinner: true });
  });
});

describe('saveCycle', () => {
  it('stamps closedAt and enqueues one outbox row', async () => {
    const cycle = await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: 62.5,
    });
    expect(cycle.closedAt).not.toBe('');
    expect(Number.isNaN(Date.parse(cycle.closedAt))).toBe(false);
    expect(cycle.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps each closed cycle rather than replacing the previous one', async () => {
    await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: 62.5,
    });
    await saveCycle('u1', {
      startDate: '2026-11-13', goalDate: '2026-12-24',
      startWeight: 62.5, targetWeight: 61, endWeight: null,
    });
    const cycles = await listCycles('u1');
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => c.startDate).sort())
      .toEqual(['2026-10-06', '2026-11-13']);
  });

  it('accepts a null end weight, for a cycle that was never weighed', async () => {
    const cycle = await saveCycle('u1', {
      startDate: '2026-10-06', goalDate: '2026-11-12',
      startWeight: 66, targetWeight: 62.3, endWeight: null,
    });
    expect(cycle.endWeight).toBeNull();
  });
});

describe('getOrCreateWeekPlan', () => {
  it('seeds the spec defaults', async () => {
    const plan = await getOrCreateWeekPlan('u1', '2026-W41');
    expect(plan.runDays).toEqual([...DEFAULT_RUN_DAYS]);
    expect(plan.noDinnerDays).toEqual([...DEFAULT_NO_DINNER_DAYS]);
    expect(plan.jokerUsedOn).toBeNull();
  });

  it('does not re-seed an edited week', async () => {
    const created = await getOrCreateWeekPlan('u1', '2026-W41');
    await db.weekPlans.update(created.id, { noDinnerDays: [3] });
    const again = await getOrCreateWeekPlan('u1', '2026-W41');
    expect(again.noDinnerDays).toEqual([3]);
  });
});
