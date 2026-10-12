import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/schema';
import {
  blankDayLog, buildTodayView, msUntilNextMidnight, useCurrentDate, useToday,
  type TodayInputs,
} from '@/features/today/useToday';
import type {
  CalorieEntry, DayLog, Run, Settings, WeekPlan,
} from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

/**
 * Deliberately NOT the defaults: DEFAULT_RUN_DAYS is [1, 2, 4, 6, 7] and
 * DEFAULT_NO_DINNER_DAYS is [3, 7]. The reference date 2026-10-06 is a Tuesday,
 * which this plan makes a no-dinner evening and not a run day - the mirror
 * image of the defaults - so a build that ignored the stored plan and fell back
 * to effectiveWeekPlan(undefined) would fail every test below.
 */
const plan: WeekPlan = {
  id: 'p1', userId: 'u1', isoWeek: '2026-W41',
  runDays: [1, 3, 5], noDinnerDays: [2],
  jokerUsedOn: null, updatedAt: '', deletedAt: null,
};

function log(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: 'l1', userId: 'u1', updatedAt: '', deletedAt: null,
    date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null, ...partial,
  };
}

function run(id: string, date: string): Run {
  return {
    id, userId: 'u1', updatedAt: '', deletedAt: null,
    date, distanceKm: 5, durationS: 1500, note: null,
  };
}

function entry(id: string, date: string, kcal: number): CalorieEntry {
  return {
    id, userId: 'u1', updatedAt: '', deletedAt: null, date, kcal, label: null,
  };
}

// Coherent by construction: 2026-10-06 is in 2026-W41, and log.date matches.
// A case that moves `date` has to move the plan's week and the log's date too.
function inputs(partial: Partial<TodayInputs> = {}): TodayInputs {
  return {
    date: '2026-10-06', settings, plan, log: log(), dayLogs: [],
    runsToday: [], calorieEntriesToday: [], calorieEntriesWeek: [], ...partial,
  };
}

describe('buildTodayView', () => {
  it('counts down to the goal date', () => {
    expect(buildTodayView(inputs()).daysLeft).toBe(37);
    expect(buildTodayView(inputs()).cycleComplete).toBe(false);
  });

  it('reports the cycle complete the day after the goal', () => {
    const view = buildTodayView(inputs({
      date: '2026-11-13',
      plan: { ...plan, isoWeek: '2026-W46' },
      log: log({ date: '2026-11-13' }),
    }));
    expect(view.cycleComplete).toBe(true);
  });

  it('builds the Tuesday checklist from the stored plan', () => {
    expect(buildTodayView(inputs()).items.map((i) => i.id))
      .toEqual(['calories', 'no_dinner', 'steps', 'water']);
  });

  it('falls back to the default shape when no week plan is stored', () => {
    // The live branch: getWeekPlan is read-only, so a fresh install's first
    // Today render has no stored plan at all.
    const view = buildTodayView(inputs({ plan: undefined }));
    expect(view.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    // Two default no-dinner evenings, five days at the daily target.
    expect(view.weeklyBudget).toBe(5 * 1500 + 2 * 900);
  });

  it('satisfies course from a run on a day the stored plan makes a run day', () => {
    // 2026-10-07 is a Wednesday, ISO weekday 3, which this plan's runDays make
    // a run day - so `course` is applicable, and runsToday is the only thing
    // that can satisfy it here: ticks.course is unset and there are no calorie
    // entries for a miscounted length to stand in for the run count.
    const view = buildTodayView(inputs({
      date: '2026-10-07',
      log: log({ date: '2026-10-07' }),
      runsToday: [{ date: '2026-10-07', distanceKm: 5, durationS: 1500 }],
    }));
    expect(view.items).toContainEqual({ id: 'course', satisfied: true });
  });

  it('leaves course unsatisfied on a run day with no run logged', () => {
    const view = buildTodayView(inputs({
      date: '2026-10-07',
      log: log({ date: '2026-10-07' }),
      runsToday: [],
    }));
    expect(view.items).toContainEqual({ id: 'course', satisfied: false });
  });

  it('validates the day when every applicable item is satisfied', () => {
    const view = buildTodayView(inputs({
      // No run on purpose: course is not applicable under this plan, so
      // omitting it keeps the case sensitive to the plan being ignored.
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 850 }],
      log: log({ steps: 8200, waterGlasses: 6, ticks: { no_dinner: true } }),
    }));
    expect(view.validated).toBe(true);
  });

  it('does not validate a day whose calories exceed the allowance', () => {
    const view = buildTodayView(inputs({
      // 1000 kcal sits under dailyCalorieTarget but over the 900 no-dinner
      // allowance this plan puts on a Tuesday. The run satisfies the course
      // item that the default plan would add, so only calories can fail.
      runsToday: [{ date: '2026-10-06', distanceKm: 5, durationS: 1500 }],
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 1000 }],
      log: log({ steps: 8200, waterGlasses: 6, ticks: { no_dinner: true } }),
    }));
    expect(view.validated).toBe(false);
  });

  it('computes the weekly remaining from the week entries, not the day entries', () => {
    const view = buildTodayView(inputs({
      calorieEntriesWeek: [
        { date: '2026-10-05', kcal: 1450 },
        { date: '2026-10-06', kcal: 1400 },
      ],
    }));
    // One marked evening in the seven: six days at the daily target plus one
    // no-dinner allowance.
    expect(view.weeklyBudget).toBe(6 * 1500 + 1 * 900);
    expect(view.weeklyRemaining).toBe(6 * 1500 + 1 * 900 - 2850);
  });

  it('counts the streak from the supplied day logs', () => {
    const view = buildTodayView(inputs({
      // startDate has to clip the walk, or a looser one would count the same.
      // 2026-10-03 is covered and consecutive, and sits a day before the start,
      // so only settings.startDate keeps it out of the count.
      settings: { ...settings, startDate: '2026-10-04' },
      dayLogs: [
        log({ date: '2026-10-03', validatedAt: '2026-10-03T21:00:00Z' }),
        // Jokered, not validated: a joker covers a day just as validation does.
        log({ date: '2026-10-04', jokered: true }),
        log({ date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      ],
    }));
    expect(view.streak).toBe(2);
  });

  it("counts today's own log even when dayLogs does not carry it yet", () => {
    // listDayLogs lists them all, today's row included, so dayLogs usually
    // carries it and the push is a duplicate that currentStreak's Set absorbs.
    // The case that needs the push is this one: on a day with no stored row,
    // `log` is blankDayLog's placeholder, which no list can supply.
    const view = buildTodayView(inputs({
      dayLogs: [],
      log: log({ validatedAt: '2026-10-06T21:00:00Z' }),
    }));
    expect(view.streak).toBe(1);
  });

  it('offers the joker on an uncovered today when the week has one left', () => {
    expect(buildTodayView(inputs()).jokerAvailable).toBe(true);
  });

  it('withholds the joker once the week has spent it', () => {
    const view = buildTodayView(inputs({ plan: { ...plan, jokerUsedOn: '2026-10-05' } }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker on a validated day', () => {
    const view = buildTodayView(inputs({
      log: log({ validatedAt: '2026-10-06T21:00:00Z' }),
    }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker on an already jokered day', () => {
    // Section 4.4: a jokered day is covered, so it is not offered the joker
    // a second time.
    const view = buildTodayView(inputs({ log: log({ jokered: true }) }));
    expect(view.jokerAvailable).toBe(false);
  });

  it('withholds the joker before the start date', () => {
    // 2026-09-30 is the day before startDate, and it lives in 2026-W40.
    const view = buildTodayView(inputs({
      date: '2026-09-30',
      plan: { ...plan, isoWeek: '2026-W40' },
      log: log({ date: '2026-09-30' }),
    }));
    expect(view.jokerAvailable).toBe(false);
  });
});

describe('msUntilNextMidnight', () => {
  it('counts to midnight in the given zone, not in the device zone', () => {
    // The suite runs in TZ=Europe/Paris, where this instant is 23:50 on the
    // 6th - ten minutes short of midnight. In Auckland it is already 10:50 on
    // the 7th, so the next midnight is thirteen hours and ten minutes off. A
    // computation that read the device zone would return the ten minutes.
    const now = new Date('2026-10-06T21:50:00Z');
    expect(msUntilNextMidnight('Europe/Paris', now)).toBe(10 * 60_000);
    expect(msUntilNextMidnight('Pacific/Auckland', now)).toBe((13 * 60 + 10) * 60_000);
  });

  it('uses the offset at that midnight, not the offset now', () => {
    // 02:30 Paris on 25 October 2026, an hour before the clocks go back: the
    // zone is at +02:00 right now and will be at +01:00 at the midnight being
    // scheduled. Reading only the current offset lands an hour early, at
    // 23:00 local on the 25th.
    const now = new Date('2026-10-25T00:30:00Z');
    expect(msUntilNextMidnight('Europe/Paris', now)).toBe(22.5 * 3_600_000);
  });

  it('never schedules a timer for the same instant or the past', () => {
    // A tenth of a second before midnight. The parts Intl hands back carry no
    // milliseconds, so the raw answer here is 100ms or less, and a timer that
    // short - or one at zero - re-fires faster than the date can change.
    // Firing a touch late costs nothing: the date is read when it fires.
    const now = new Date('2026-10-06T21:59:59.900Z');
    expect(msUntilNextMidnight('Europe/Paris', now)).toBe(1000);
  });
});

describe('useCurrentDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has no date until a zone is known', () => {
    // The zone comes from a stored settings row, so it is undefined for the
    // first render or two. A date guessed in the device zone in the meantime
    // would be the wrong DAY for half the planet, and the view would be built
    // on it.
    const { result } = renderHook(() => useCurrentDate(undefined));
    expect(result.current).toBeUndefined();
  });

  it('moves to the new date when the scheduled midnight arrives', async () => {
    // setTimeout faked as well here, because the wait is ten minutes long.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    // 23:50 in Paris on Tuesday the 6th: spec 10's "ticked at 23h in bed".
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));

    const { result } = renderHook(() => useCurrentDate('Europe/Paris'));
    expect(result.current).toBe('2026-10-06');

    // Nine minutes: still the 6th, so the timer is not merely a short poll
    // that would pass whatever it was scheduled for.
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
    expect(result.current).toBe('2026-10-06');

    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
    expect(result.current).toBe('2026-10-07');

    // And the next midnight is scheduled too, rather than one day being all
    // the timer was good for.
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 3_600_000); });
    expect(result.current).toBe('2026-10-08');
  });

  it('moves to the new date when the tab is resumed after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));

    const { result } = renderHook(() => useCurrentDate('Europe/Paris'));
    expect(result.current).toBe('2026-10-06');

    // A home-screen PWA on iOS is resumed from the background, not reloaded,
    // and a timer in a frozen tab does not fire on time - so without this the
    // stale date survives for days.
    vi.setSystemTime(new Date('2026-10-06T22:10:00Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current).toBe('2026-10-07');
  });

  it('takes its listener back off the document when unmounted', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));
    // Asserted through the listener itself rather than through a later
    // dispatch: React 19 no longer warns about a setState on an unmounted
    // hook, so a dispatch after unmount is observably nothing either way -
    // a case that could not fail. A listener left behind outlives every
    // screen the user opens.
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useCurrentDate('Europe/Paris'));
    const registered = added.mock.calls
      .filter(([type]) => type === 'visibilitychange')
      .map(([, handler]) => handler);
    expect(registered).toHaveLength(1);

    unmount();
    expect(removed).toHaveBeenCalledWith('visibilitychange', registered[0]);
    added.mockRestore();
    removed.mockRestore();
  });
});

describe('blankDayLog', () => {
  it('builds an unlogged day', () => {
    // The whole shape, not a sample of it: a surviving `jokered` would keep the
    // streak alive on a day nobody logged, and a stale bonusFiredAt would
    // suppress the reward a later task fires off it.
    expect(blankDayLog('u1', '2026-10-06')).toEqual({
      id: '', userId: 'u1', updatedAt: '', deletedAt: null,
      date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    });
  });

  it('carries no id, because no such row exists', () => {
    // An id here would be either a tombstoned row's, which no caller could
    // tell from a live one, or a fresh one minted on every re-run of the
    // querier. The empty string can be mistaken for neither.
    expect(blankDayLog('u1', '2026-10-06').id).toBe('');
  });
});

describe('useToday', () => {
  beforeEach(async () => {
    // A fresh store per case: delete rather than clear, so no schema or row
    // from an earlier case can make a later one pass.
    await db.delete();
    await db.open();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves to a defined view against a seeded settings row', async () => {
    // Date only, so Testing Library's waitFor keeps its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    // Midday in Paris on the Tuesday the pure cases above use.
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    const view = result.current;
    expect(view?.date).toBe('2026-10-06');
    // No stored week plan on a fresh install, so the default shape applies:
    // DEFAULT_RUN_DAYS includes Tuesday, so `course` is in.
    expect(view?.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    expect(view?.validated).toBe(false);
    expect(view?.daysLeft).toBe(37);
    // Opening the app reads; it does not write. A getOrCreate here would both
    // reject inside the liveQuery context and leave a row behind.
    expect(await db.dayLogs.count()).toBe(0);
    expect(await db.weekPlans.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('shows an unlogged placeholder when no day log is stored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.log).toEqual(blankDayLog('u1', '2026-10-06'));
  });

  it('reads the stored day log when there is one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);
    await db.dayLogs.put(log({ steps: 9100, waterGlasses: 6 }));

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.log.id).toBe('l1');
    expect(result.current?.log.steps).toBe(9100);
  });

  it('treats a tombstoned day log as unlogged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    await db.settings.put(settings);
    await db.dayLogs.put(log({
      deletedAt: '2026-10-06T08:00:00Z', steps: 9100, jokered: true,
    }));

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    // The placeholder, id and all: the tombstoned row's ticks, steps, joker
    // and validation must not reach the view, and nor must its id.
    expect(result.current?.log).toEqual(blankDayLog('u1', '2026-10-06'));
  });

  it('reads the date in the stored zone rather than in UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 on the 7th in Paris, still the 6th in UTC. The mirror image of the
    // fallback case below: between them, only settings.timezone gives the date
    // these two cases expect.
    vi.setSystemTime(new Date('2026-10-06T22:30:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.date).toBe('2026-10-07');
  });

  it('falls back to UTC when the stored timezone is one this runtime rejects', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 01:30 on the 7th in Paris, still the 6th in UTC, so the fallback zone is
    // pinned and not just the fact that the querier survived.
    vi.setSystemTime(new Date('2026-10-06T23:30:00Z'));
    await db.settings.put({ ...settings, timezone: 'Not/AZone' });

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    expect(result.current?.date).toBe('2026-10-06');
  });

  it('feeds the stored plan, logs, runs and week entries into the view', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Midday in Paris on Wednesday 2026-10-07, which is in 2026-W41 - the week
    // the stored plan below is keyed to.
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    await db.settings.put(settings);
    await db.weekPlans.put(plan);
    await db.dayLogs.bulkPut([
      log({ id: 'l5', date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      log({ id: 'l6', date: '2026-10-06', validatedAt: '2026-10-06T21:00:00Z' }),
    ]);
    // Nothing on 2026-10-07 itself, in either table: that is what makes the
    // two per-day filters observable, because an unfiltered list would hand
    // the build a run count and an entry count that today did not earn.
    await db.runs.bulkPut([run('r6', '2026-10-06'), run('r28', '2026-09-28')]);
    await db.calorieEntries.bulkPut([
      entry('c6', '2026-10-06', 1400),
      entry('c5', '2026-10-05', 1450),
      // 2026-09-28 is the Monday of 2026-W40, so weekDates must exclude it.
      entry('c28', '2026-09-28', 2000),
    ]);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());

    const view = result.current;
    expect(view?.date).toBe('2026-10-07');
    // The stored plan reached the build: it makes Wednesday a run day and not
    // a no-dinner evening, where the defaults do the exact opposite.
    expect(view?.items.map((i) => i.id)).toEqual(['course', 'calories', 'steps', 'water']);
    expect(view?.items).toContainEqual({ id: 'course', satisfied: false });
    expect(view?.items).toContainEqual({ id: 'calories', satisfied: false });
    // listDayLogs reached it too: the two covered days before an uncovered
    // today, with today's own row absent and a placeholder in its place.
    expect(view?.streak).toBe(2);
    // Six days at the daily target plus the Tuesday allowance this plan marks,
    // less the two in-week entries and not the 2026-W40 one.
    expect(view?.weeklyBudget).toBe(6 * 1500 + 900);
    expect(view?.weeklyRemaining).toBe(6 * 1500 + 900 - 2850);
  });

  it('re-reads the day when the clock crosses midnight under a mounted screen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 23:50 in Paris on Tuesday the 6th, with the screen staying mounted
    // across midnight - the primary use case, and the one the date computed
    // inside the querier could never notice: a querier re-runs on an observed
    // TABLE change, and midnight is not one.
    vi.setSystemTime(new Date('2026-10-06T21:50:00Z'));
    await db.settings.put(settings);

    const { result } = renderHook(() => useToday('u1'));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current?.date).toBe('2026-10-06');

    vi.setSystemTime(new Date('2026-10-06T22:10:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));

    // The whole view moves with it, not just the date field: Wednesday is a
    // no-dinner evening under the defaults and Tuesday is a run day, so the
    // items are the proof that the querier re-ran rather than the state alone
    // having changed.
    await waitFor(() => expect(result.current?.date).toBe('2026-10-07'));
    expect(result.current?.items.map((i) => i.id))
      .toEqual(['calories', 'no_dinner', 'steps', 'water']);
    expect(result.current?.log).toEqual(blankDayLog('u1', '2026-10-07'));
  });

  it('resolves to undefined while no settings row exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    const { result } = renderHook(() => useToday('u1'));

    // Seeded first and waited on, so the querier has demonstrably run; then
    // the row is taken away. result.current is undefined on the first render
    // whatever the querier does, so asserting it straight away would prove
    // nothing. The re-run has to return undefined rather than throw on the
    // missing row, which is what the early return is for.
    await db.settings.put(settings);
    await waitFor(() => expect(result.current).toBeDefined());
    await db.settings.delete('u1');
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
