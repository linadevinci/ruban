import { describe, expect, it } from 'vitest';
import { buildTodayView, liveDayLog, type TodayInputs } from '@/features/today/useToday';
import type { DayLog, Settings, WeekPlan } from '@/domain/types';

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
      dayLogs: [
        // Jokered, not validated: a joker covers a day just as validation does.
        log({ date: '2026-10-04', jokered: true }),
        log({ date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      ],
    }));
    expect(view.streak).toBe(2);
  });

  it("counts today's own log even when dayLogs does not carry it yet", () => {
    // The hook reads getOrCreateDayLog and listDayLogs in two concurrent
    // transactions, so today's row can be missing from the list.
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

describe('liveDayLog', () => {
  it('treats a tombstoned day log as unlogged', () => {
    const dead = log({
      deletedAt: '2026-10-06T08:00:00Z', steps: 9000, waterGlasses: 4,
      jokered: true, validatedAt: '2026-10-06T21:00:00Z',
      bonusFiredAt: '2026-10-06T21:00:01Z', ticks: { course: true },
      mood: 4, energy: 3, note: 'ok',
    });
    // The whole blanked shape, not a sample of it: a surviving `jokered` would
    // keep the streak alive on an invisible day, and a stale bonusFiredAt would
    // suppress the reward a later task fires off it.
    expect(liveDayLog(dead)).toEqual({
      id: 'l1', userId: 'u1', updatedAt: '', deletedAt: null,
      date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
      jokered: false, validatedAt: null, bonusFiredAt: null,
      mood: null, energy: null, note: null,
    });
  });

  it('passes a live day log through untouched', () => {
    const l = log({ steps: 9000, jokered: true });
    // Identity alone would still hold if the row were blanked in place.
    expect(liveDayLog(l)).toBe(l);
    expect(liveDayLog(l).steps).toBe(9000);
    expect(liveDayLog(l).jokered).toBe(true);
  });
});
