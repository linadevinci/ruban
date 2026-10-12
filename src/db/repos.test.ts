import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import {
  getDayLog, getOrCreateDayLog, getOrCreateWeekPlan, getSettings, getWeekPlan,
  listCalorieEntries, listCycles, listDayLogs, listRuns, listWeights,
  saveCalorieEntry, saveCycle, saveRun, saveSettings, saveWeight, softDelete,
  spendJoker, stampDayLog, updateDayLog, updateWeekPlan,
} from '@/db/repos';
import { DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS, type Settings } from '@/domain/types';

const settingsInput: Omit<Settings, 'updatedAt'> = {
  userId: 'u1', timezone: 'Europe/Paris', startDate: '2026-10-06',
  startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false,
};

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
  it('enqueues exactly one outbox row', async () => {
    await saveRun('u1', { date: '2026-10-06', distanceKm: 5, durationS: 1500, note: null });
    expect(await db.outbox.count()).toBe(1);
  });

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

  it('enqueues exactly one outbox row when the day did not exist yet', async () => {
    await db.outbox.clear();
    await updateDayLog('u1', '2026-10-09', { steps: 8000 });
    // Two rows here would mean the create and the update ran as separate
    // writes, which is the two-transaction shape this guards against.
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps both ticks when two updates race', async () => {
    await Promise.all([
      updateDayLog('u1', '2026-10-10', { ticks: { course: true } }),
      updateDayLog('u1', '2026-10-10', { ticks: { calories: true } }),
    ]);
    const log = await getOrCreateDayLog('u1', '2026-10-10');
    expect(log.ticks).toEqual({ course: true, calories: true });
  });

  it('applies the function form to the stored row', async () => {
    await updateDayLog('u1', '2026-10-06', { waterGlasses: 4 });
    const after = await updateDayLog('u1', '2026-10-06', (row) => ({
      waterGlasses: (row.waterGlasses ?? 0) + 1,
    }));
    expect(after.waterGlasses).toBe(5);
  });

  it('hands the function form a blank row on a day with none stored', async () => {
    const after = await updateDayLog('u1', '2026-10-12', (row) => ({
      waterGlasses: (row.waterGlasses ?? 0) + 1,
      ticks: { course: row.ticks.course !== true },
    }));
    expect(after.waterGlasses).toBe(1);
    expect(after.ticks).toEqual({ course: true });
    expect(await db.dayLogs.count()).toBe(1);
  });

  it('loses no increment when three of them are in flight together', async () => {
    // Three taps on the water stepper with nothing awaited between them. The
    // caller cannot know the stored count - the one it rendered is a
    // useLiveQuery snapshot, and no new one can arrive until the first write
    // has landed - so all three would read 0 and all three would store 1.
    // The function form is applied inside the transaction, where the row is
    // the stored one.
    const bump = () => updateDayLog('u1', '2026-10-11', (row) => ({
      waterGlasses: (row.waterGlasses ?? 0) + 1,
    }));
    await Promise.all([bump(), bump(), bump()]);
    expect((await getOrCreateDayLog('u1', '2026-10-11')).waterGlasses).toBe(3);
  });

  it('flips a tick back when a tick and an untick are in flight together', async () => {
    const flip = () => updateDayLog('u1', '2026-10-13', (row) => ({
      ticks: { calories: row.ticks.calories !== true },
    }));
    await Promise.all([flip(), flip()]);
    // On, then off: a mistaken tick taken straight back must not survive.
    expect((await getOrCreateDayLog('u1', '2026-10-13')).ticks.calories).toBe(false);
  });
});

describe('spendJoker', () => {
  it('marks the day and the week in one go', async () => {
    const { log, plan } = await spendJoker('u1', '2026-10-06');
    expect(log.jokered).toBe(true);
    expect(plan.jokerUsedOn).toBe('2026-10-06');
    expect((await getDayLog('u1', '2026-10-06'))?.jokered).toBe(true);
    expect((await getWeekPlan('u1', '2026-W41'))?.jokerUsedOn).toBe('2026-10-06');
    // One push per row, and no more: the day log is created and written once.
    expect(await db.outbox.count()).toBe(2);
  });

  it('records the spend on the week of the day being excused', async () => {
    // Sunday 2026-10-11 is the LAST day of 2026-W41; the next day opens W42.
    // ISO weeks start on Monday, so a Sunday is the one case that tells the
    // excused date's week apart from any week read off the following day.
    await spendJoker('u1', '2026-10-11');
    expect((await getWeekPlan('u1', '2026-W41'))?.jokerUsedOn).toBe('2026-10-11');
    expect(await getWeekPlan('u1', '2026-W42')).toBeUndefined();
  });

  it('writes neither row when the second write cannot be made', async () => {
    // One invariant - spec 4.4's one joker per ISO week - over two rows, so
    // the two writes share one transaction and a failure between them rolls
    // the first back. Done as two calls, the day would come out jokered with
    // no spend recorded: the joker burnt, and the day it was meant to excuse
    // still breaking the streak. The trigger here is a date that has no ISO
    // week, which throws after the day log has been written.
    await expect(spendJoker('u1', '2026-02-31')).rejects.toThrow();
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.weekPlans.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('stampDayLog', () => {
  it('stamps both fields and enqueues one outbox row when the day did not exist yet', async () => {
    await db.outbox.clear();
    const stamps = await stampDayLog('u1', '2026-10-06');
    expect(stamps).toEqual({ validatedNow: true, fireBonus: true });
    const log = await getDayLog('u1', '2026-10-06');
    // typeof, not not.toBeNull(): on a row that was never written log is
    // undefined, and expect(undefined).not.toBeNull() passes.
    expect(typeof log?.validatedAt).toBe('string');
    expect(typeof log?.bonusFiredAt).toBe('string');
    // One event, one instant, and one write: two rows would mean a create and
    // an update ran as separate writes.
    expect(log?.validatedAt).toBe(log?.bonusFiredAt);
    expect(log?.updatedAt).toBe(log?.validatedAt);
    expect(await db.dayLogs.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('stamps only the fields that are still null, and touches nothing else', async () => {
    const created = await updateDayLog('u1', '2026-10-06', {
      validatedAt: '2026-10-06T19:00:00.000Z',
      ticks: { course: true }, steps: 8200,
    });
    const stamps = await stampDayLog('u1', '2026-10-06');
    expect(stamps).toEqual({ validatedNow: false, fireBonus: true });
    const log = await getDayLog('u1', '2026-10-06');
    expect(log?.id).toBe(created.id);
    expect(log?.validatedAt).toBe('2026-10-06T19:00:00.000Z');
    expect(typeof log?.bonusFiredAt).toBe('string');
    expect(log?.ticks).toEqual({ course: true });
    expect(log?.steps).toBe(8200);
  });

  it('stamps a missing validatedAt without moving an already fired bonus', async () => {
    // The mirror of the case above, so each field is pinned on its own rather
    // than both by one assertion.
    await updateDayLog('u1', '2026-10-06', { bonusFiredAt: '2026-10-06T19:00:00.000Z' });
    const stamps = await stampDayLog('u1', '2026-10-06');
    expect(stamps).toEqual({ validatedNow: true, fireBonus: false });
    const log = await getDayLog('u1', '2026-10-06');
    expect(log?.bonusFiredAt).toBe('2026-10-06T19:00:00.000Z');
    expect(typeof log?.validatedAt).toBe('string');
  });

  it('writes nothing once both stamps are set', async () => {
    await stampDayLog('u1', '2026-10-06');
    const stamped = await getDayLog('u1', '2026-10-06');
    await db.outbox.clear();
    const again = await stampDayLog('u1', '2026-10-06');
    expect(again).toEqual({ validatedNow: false, fireBonus: false });
    const log = await getDayLog('u1', '2026-10-06');
    expect(typeof log?.validatedAt).toBe('string');
    // nowIso() never repeats, so a redundant write would move all three.
    expect(log?.validatedAt).toBe(stamped?.validatedAt);
    expect(log?.bonusFiredAt).toBe(stamped?.bonusFiredAt);
    expect(log?.updatedAt).toBe(stamped?.updatedAt);
    expect(await db.outbox.count()).toBe(0);
  });

  it('reports the bonus to exactly one of two racing callers', async () => {
    // The check and the set must share one transaction. Reading the row first
    // and writing after would let both callers see validatedAt: null, both
    // stamp, and both fire the one-time celebration.
    await updateDayLog('u1', '2026-10-10', { ticks: { course: true } });
    await db.outbox.clear();
    const stamps = await Promise.all([
      stampDayLog('u1', '2026-10-10'),
      stampDayLog('u1', '2026-10-10'),
    ]);
    expect(stamps.filter((s) => s.fireBonus)).toHaveLength(1);
    expect(stamps.filter((s) => s.validatedNow)).toHaveLength(1);
    expect(await db.dayLogs.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
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

describe('softDelete beyond runs', () => {
  it('tombstones a weigh-in and hides it from the list', async () => {
    const weight = await saveWeight('u1', '2026-10-06', 62.4);
    await db.outbox.clear();
    await softDelete('weights', weight.id);
    expect((await db.weights.get(weight.id))?.deletedAt).not.toBeNull();
    expect(await listWeights('u1')).toHaveLength(0);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.orderBy('seq').last())?.op).toBe('delete');
  });

  it('tombstones a calorie entry and hides it from the list', async () => {
    const entry = await saveCalorieEntry('u1', '2026-10-06', 420, 'dejeuner');
    await db.outbox.clear();
    await softDelete('calorieEntries', entry.id);
    expect((await db.calorieEntries.get(entry.id))?.deletedAt).not.toBeNull();
    expect(await listCalorieEntries('u1')).toHaveLength(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it('queues nothing for an unknown id instead of a change with no payload', async () => {
    // update() resolves 0 for a missing key without throwing, so the old shape
    // enqueued payload: undefined.
    await expect(softDelete('runs', 'no-such-id')).resolves.toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('saveCalorieEntry / listCalorieEntries', () => {
  it('allows several entries on one date', async () => {
    await saveCalorieEntry('u1', '2026-10-06', 420, 'petit dejeuner');
    await saveCalorieEntry('u1', '2026-10-06', 380, 'dejeuner');
    const entries = await listCalorieEntries('u1');
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + e.kcal, 0)).toBe(800);
    expect(await db.outbox.count()).toBe(2);
  });

  it('drops a tombstoned entry from the list but keeps the row', async () => {
    const keep = await saveCalorieEntry('u1', '2026-10-06', 420, null);
    const drop = await saveCalorieEntry('u1', '2026-10-06', 380, null);
    await softDelete('calorieEntries', drop.id);
    expect((await listCalorieEntries('u1')).map((e) => e.id)).toEqual([keep.id]);
    expect(await db.calorieEntries.count()).toBe(2);
  });
});

describe('listDayLogs', () => {
  it('excludes a tombstoned day log', async () => {
    const keep = await getOrCreateDayLog('u1', '2026-10-06');
    const drop = await getOrCreateDayLog('u1', '2026-10-07');
    await db.dayLogs.update(drop.id, { deletedAt: '2026-10-07T20:00:00.000Z' });
    expect((await listDayLogs('u1')).map((l) => l.id)).toEqual([keep.id]);
    expect(await db.dayLogs.count()).toBe(2);
  });
});

describe('saveSettings / getSettings', () => {
  it('round-trips and enqueues one outbox row', async () => {
    const saved = await saveSettings(settingsInput);
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);
    const read = await getSettings('u1');
    expect(read).toEqual(saved);
    expect(read?.timezone).toBe('Europe/Paris');
    expect(read?.stepTarget).toBe(8000);
    expect(await db.outbox.count()).toBe(1);
  });

  it('replaces the row on a second save rather than duplicating it', async () => {
    await saveSettings(settingsInput);
    const second = await saveSettings({ ...settingsInput, stepTarget: 9000 });
    expect(await db.settings.count()).toBe(1);
    expect((await getSettings('u1'))?.stepTarget).toBe(9000);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(0);
    expect(await db.outbox.count()).toBe(2);
  });

  it('returns undefined for a user with no settings, even when another has some', async () => {
    // Another user's row must not leak through: an empty table alone would let
    // a getSettings that ignores the user id pass.
    await saveSettings(settingsInput);
    expect(await getSettings('nobody')).toBeUndefined();
    expect((await getSettings('u1'))?.userId).toBe('u1');
  });
});

describe('updateWeekPlan', () => {
  it('merges a patch and bumps updatedAt', async () => {
    const created = await getOrCreateWeekPlan('u1', '2026-W41');
    const patched = await updateWeekPlan('u1', '2026-W41', { noDinnerDays: [3] });
    expect(patched.id).toBe(created.id);
    expect(patched.noDinnerDays).toEqual([3]);
    expect(patched.runDays).toEqual([...DEFAULT_RUN_DAYS]); // untouched by the patch
    expect(Date.parse(patched.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('enqueues exactly one outbox row when the week did not exist yet', async () => {
    await db.outbox.clear();
    await updateWeekPlan('u1', '2026-W42', { jokerUsedOn: '2026-10-13' });
    // Two rows would mean the create and the update ran as separate writes.
    expect(await db.outbox.count()).toBe(1);
    expect(await db.weekPlans.count()).toBe(1);
  });

  it('keeps both fields when two updates race', async () => {
    // The joker field is the one-joker-per-week invariant: a lost update here
    // would silently hand the week a second joker.
    await Promise.all([
      updateWeekPlan('u1', '2026-W43', { jokerUsedOn: '2026-10-20' }),
      updateWeekPlan('u1', '2026-W43', { runDays: [1, 3] }),
    ]);
    const plan = await getOrCreateWeekPlan('u1', '2026-W43');
    expect(plan.jokerUsedOn).toBe('2026-10-20');
    expect(plan.runDays).toEqual([1, 3]);
    expect(await db.weekPlans.count()).toBe(1);
  });
});

describe('getDayLog', () => {
  it('returns undefined for a day that was never logged', async () => {
    expect(await getDayLog('u1', '2026-10-06')).toBeUndefined();
  });

  it('returns the stored row when one exists', async () => {
    const created = await getOrCreateDayLog('u1', '2026-10-06');
    expect((await getDayLog('u1', '2026-10-06'))?.id).toBe(created.id);
  });

  it('returns undefined once the row is tombstoned', async () => {
    const created = await getOrCreateDayLog('u1', '2026-10-06');
    await db.dayLogs.update(created.id, { deletedAt: '2026-10-06T20:00:00.000Z' });
    expect(await getDayLog('u1', '2026-10-06')).toBeUndefined();
  });

  it('writes nothing, so a reactive read cannot mutate what it observes', async () => {
    const rowsBefore = await db.dayLogs.count();
    const outboxBefore = await db.outbox.count();
    expect(await getDayLog('u1', '2026-10-06')).toBeUndefined();
    expect(await db.dayLogs.count()).toBe(rowsBefore);
    expect(await db.outbox.count()).toBe(outboxBefore);
    expect(rowsBefore).toBe(0);
    expect(outboxBefore).toBe(0);
  });
});

describe('getWeekPlan', () => {
  it('returns undefined for a week that was never planned', async () => {
    expect(await getWeekPlan('u1', '2026-W41')).toBeUndefined();
  });

  it('returns the stored row when one exists', async () => {
    const created = await getOrCreateWeekPlan('u1', '2026-W41');
    expect((await getWeekPlan('u1', '2026-W41'))?.id).toBe(created.id);
  });

  it('returns undefined once the row is tombstoned', async () => {
    const created = await getOrCreateWeekPlan('u1', '2026-W41');
    await db.weekPlans.update(created.id, { deletedAt: '2026-10-11T20:00:00.000Z' });
    expect(await getWeekPlan('u1', '2026-W41')).toBeUndefined();
  });

  it('writes nothing, so a reactive read cannot mutate what it observes', async () => {
    const rowsBefore = await db.weekPlans.count();
    const outboxBefore = await db.outbox.count();
    expect(await getWeekPlan('u1', '2026-W41')).toBeUndefined();
    expect(await db.weekPlans.count()).toBe(rowsBefore);
    expect(await db.outbox.count()).toBe(outboxBefore);
    expect(rowsBefore).toBe(0);
    expect(outboxBefore).toBe(0);
  });
});
