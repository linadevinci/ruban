import { describe, expect, it } from 'vitest';
import {
  applicableItems, effectiveWeekPlan, evaluateChecklist, isDayValidated,
  type ChecklistPlan, type DayEvaluation,
} from '@/domain/checklist';
import {
  DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS,
  type DayLog, type Settings, type WeekPlan,
} from '@/domain/types';

const plan: ChecklistPlan = { runDays: [1, 2, 4, 6, 7], noDinnerDays: [3, 7] };

const settings = {
  dailyCalorieTarget: 1500,
  noDinnerAllowance: 900,
  calorieFloor: 1200,
  stepTarget: 8000,
  waterTarget: 6,
} as Pick<Settings,
  'dailyCalorieTarget' | 'noDinnerAllowance' | 'calorieFloor' | 'stepTarget' | 'waterTarget'>;

function log(partial: Partial<DayLog> = {}): DayLog {
  return {
    id: 'id', userId: 'u', updatedAt: '', deletedAt: null,
    date: '2026-10-06', ticks: {}, steps: null, waterGlasses: null,
    jokered: false, validatedAt: null, bonusFiredAt: null,
    mood: null, energy: null, note: null,
    ...partial,
  };
}

function evaluation(partial: Partial<DayEvaluation> = {}): DayEvaluation {
  return {
    date: '2026-10-06', plan, settings, log: log(),
    runCount: 0, calorieTotal: 0, calorieEntryCount: 0,
    ...partial,
  };
}

describe('effectiveWeekPlan', () => {
  const stored: WeekPlan = {
    id: 'w', userId: 'u', updatedAt: '', deletedAt: null,
    isoWeek: '2026-W41', runDays: [2, 5], noDinnerDays: [1], jokerUsedOn: null,
  };

  it('returns the stored plan unchanged', () => {
    const result = effectiveWeekPlan(stored);
    expect(result).toBe(stored); // the same object, with no default merged in
    expect(result.runDays).toEqual([2, 5]);
    expect(result.noDinnerDays).toEqual([1]);
  });

  it('supplies the spec defaults for a week that was never planned', () => {
    expect(effectiveWeekPlan(undefined)).toEqual({
      runDays: [...DEFAULT_RUN_DAYS],
      noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
    });
  });

  it('returns copies, so mutating the result cannot alter the shared constants', () => {
    const plan = effectiveWeekPlan(undefined);
    plan.runDays.push(3);
    plan.noDinnerDays.length = 0;
    expect(DEFAULT_RUN_DAYS).toEqual([1, 2, 4, 6, 7]);
    expect(DEFAULT_NO_DINNER_DAYS).toEqual([3, 7]);
    expect(effectiveWeekPlan(undefined).runDays).toEqual([...DEFAULT_RUN_DAYS]);
  });
});

describe('applicableItems', () => {
  it('shows course on a planned run day', () => {
    // Tuesday is a run day and not a no-dinner evening.
    expect(applicableItems('2026-10-06', plan)).toEqual(['course', 'calories', 'steps', 'water']);
  });

  it('shows no_dinner and hides course on Wednesday, the rest day', () => {
    expect(applicableItems('2026-10-07', plan)).toEqual(['calories', 'no_dinner', 'steps', 'water']);
  });

  it('shows both on Sunday, which runs and skips dinner', () => {
    expect(applicableItems('2026-10-11', plan))
      .toEqual(['course', 'calories', 'no_dinner', 'steps', 'water']);
  });

  it('shows neither on Friday, which rests and dines', () => {
    expect(applicableItems('2026-10-09', plan)).toEqual(['calories', 'steps', 'water']);
  });
});

describe('evaluateChecklist', () => {
  it('auto-satisfies course from a logged run', () => {
    const items = evaluateChecklist(evaluation({ runCount: 1 }));
    expect(items.find((i) => i.id === 'course')?.satisfied).toBe(true);
  });

  it('satisfies course from a manual tick with no run logged', () => {
    const items = evaluateChecklist(evaluation({ log: log({ ticks: { course: true } }) }));
    expect(items.find((i) => i.id === 'course')?.satisfied).toBe(true);
  });

  it('auto-satisfies calories once entries exist and the total is within allowance', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 1400, calorieEntryCount: 3 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(true);
  });

  it('does not auto-satisfy calories when nothing was logged', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 0, calorieEntryCount: 0 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('satisfies calories when the total lands exactly on the allowance', () => {
    // Logging exactly to target is a hit, not a miss. Tuesday's allowance is
    // the 1500 daily target.
    const items = evaluateChecklist(evaluation({ calorieTotal: 1500, calorieEntryCount: 3 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(true);
  });

  it('auto-unsatisfies calories once the total passes the allowance', () => {
    const items = evaluateChecklist(evaluation({ calorieTotal: 1700, calorieEntryCount: 4 }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('lets a manual override win in both directions', () => {
    const forcedOn = evaluateChecklist(evaluation({
      calorieTotal: 1700, calorieEntryCount: 4, log: log({ ticks: { calories: true } }),
    }));
    expect(forcedOn.find((i) => i.id === 'calories')?.satisfied).toBe(true);

    const forcedOff = evaluateChecklist(evaluation({
      calorieTotal: 1000, calorieEntryCount: 2, log: log({ ticks: { calories: false } }),
    }));
    expect(forcedOff.find((i) => i.id === 'calories')?.satisfied).toBe(false);
  });

  it('measures calories against the no-dinner allowance on a no-dinner day', () => {
    const items = evaluateChecklist(evaluation({
      date: '2026-10-07', calorieTotal: 1000, calorieEntryCount: 2,
    }));
    expect(items.find((i) => i.id === 'calories')?.satisfied).toBe(false); // 1000 > 900
  });

  it('satisfies steps and water once the logged amounts reach their targets', () => {
    const items = evaluateChecklist(evaluation({
      log: log({ steps: 8200, waterGlasses: 6 }),
    }));
    expect(items.find((i) => i.id === 'steps')?.satisfied).toBe(true);
    expect(items.find((i) => i.id === 'water')?.satisfied).toBe(true);

    const short = evaluateChecklist(evaluation({ log: log({ steps: 7999, waterGlasses: 5 }) }));
    expect(short.find((i) => i.id === 'steps')?.satisfied).toBe(false);
    expect(short.find((i) => i.id === 'water')?.satisfied).toBe(false);
  });

  it('treats a missing log as nothing satisfied', () => {
    const items = evaluateChecklist(evaluation({ log: undefined }));
    expect(items.every((i) => !i.satisfied)).toBe(true);
  });
});

describe('isDayValidated', () => {
  it('requires every applicable item, and a rest day needs fewer', () => {
    // Wednesday: calories, no_dinner, steps, water. No run required.
    const wednesday = evaluateChecklist(evaluation({
      date: '2026-10-07',
      calorieTotal: 800, calorieEntryCount: 2,
      log: log({ date: '2026-10-07', ticks: { no_dinner: true }, steps: 8000, waterGlasses: 6 }),
    }));
    expect(isDayValidated(wednesday)).toBe(true);
  });

  it('fails a run day with no run', () => {
    const tuesday = evaluateChecklist(evaluation({
      calorieTotal: 1400, calorieEntryCount: 2,
      log: log({ steps: 8000, waterGlasses: 6 }),
      runCount: 0,
    }));
    expect(isDayValidated(tuesday)).toBe(false);
  });

  it('validates a full run day', () => {
    const tuesday = evaluateChecklist(evaluation({
      calorieTotal: 1400, calorieEntryCount: 2, runCount: 1,
      log: log({ steps: 8000, waterGlasses: 6 }),
    }));
    expect(isDayValidated(tuesday)).toBe(true);
  });

  it('is false for an empty list, so an unknown day never counts', () => {
    expect(isDayValidated([])).toBe(false);
  });
});
