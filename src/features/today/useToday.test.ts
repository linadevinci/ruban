import { describe, expect, it } from 'vitest';
import { buildTodayView, liveDayLog, type TodayInputs } from '@/features/today/useToday';
import { DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS, type DayLog, type Settings, type WeekPlan } from '@/domain/types';

const settings: Settings = {
  userId: 'u1', timezone: 'Europe/Paris',
  startDate: '2026-10-01', startWeight: 66, targetWeight: 62.3, goalDate: '2026-11-12',
  weighInCadence: 'daily', dailyCalorieTarget: 1500, noDinnerAllowance: 900,
  calorieFloor: 1200, stepTarget: 8000, waterTarget: 6, runSessionsTarget: 5,
  soundEnabled: false, updatedAt: '',
};

const plan: WeekPlan = {
  id: 'p1', userId: 'u1', isoWeek: '2026-W41',
  runDays: [...DEFAULT_RUN_DAYS], noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
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
    const view = buildTodayView(inputs({ date: '2026-11-13' }));
    expect(view.cycleComplete).toBe(true);
  });

  it('builds a Tuesday checklist without no_dinner', () => {
    expect(buildTodayView(inputs()).items.map((i) => i.id))
      .toEqual(['course', 'calories', 'steps', 'water']);
  });

  it('validates the day when every applicable item is satisfied', () => {
    const view = buildTodayView(inputs({
      runsToday: [{ date: '2026-10-06', distanceKm: 5, durationS: 1500 }],
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 1400 }],
      log: log({ steps: 8200, waterGlasses: 6 }),
    }));
    expect(view.validated).toBe(true);
  });

  it('does not validate a day whose calories exceed the allowance', () => {
    const view = buildTodayView(inputs({
      runsToday: [{ date: '2026-10-06', distanceKm: 5, durationS: 1500 }],
      calorieEntriesToday: [{ date: '2026-10-06', kcal: 1900 }],
      log: log({ steps: 8200, waterGlasses: 6 }),
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
    expect(view.weeklyBudget).toBe(5 * 1500 + 2 * 900);
    expect(view.weeklyRemaining).toBe(5 * 1500 + 2 * 900 - 2850);
  });

  it('counts the streak from the supplied day logs', () => {
    const view = buildTodayView(inputs({
      dayLogs: [
        log({ date: '2026-10-04', validatedAt: '2026-10-04T21:00:00Z' }),
        log({ date: '2026-10-05', validatedAt: '2026-10-05T21:00:00Z' }),
      ],
    }));
    expect(view.streak).toBe(2);
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
});

describe('liveDayLog', () => {
  it('treats a tombstoned day log as unlogged', () => {
    const dead = log({ deletedAt: '2026-10-06T08:00:00Z', steps: 9000, validatedAt: '2026-10-06T21:00:00Z', ticks: { course: true } });
    const live = liveDayLog(dead);
    expect(live.deletedAt).toBeNull();
    expect(live.steps).toBeNull();
    expect(live.validatedAt).toBeNull();
    expect(live.ticks).toEqual({});
  });

  it('passes a live day log through untouched', () => {
    const l = log({ steps: 9000 });
    expect(liveDayLog(l)).toBe(l);
  });
});
