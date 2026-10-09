import { describe, expect, it } from 'vitest';
import {
  dayAllowance, floorWarnings, weeklyBudget, weeklyRemaining,
  type BudgetPlan, type BudgetSettings,
} from '@/domain/budget';

const settings: BudgetSettings = {
  dailyCalorieTarget: 1500,
  noDinnerAllowance: 900,
  calorieFloor: 1200,
};
const defaultPlan: BudgetPlan = { noDinnerDays: [3, 7] }; // Wednesday, Sunday

describe('dayAllowance', () => {
  it('gives a normal day the daily target', () => {
    expect(dayAllowance('2026-10-06', defaultPlan, settings)).toBe(1500); // Tuesday
  });

  it('gives a no-dinner day the reduced allowance', () => {
    expect(dayAllowance('2026-10-07', defaultPlan, settings)).toBe(900); // Wednesday
    expect(dayAllowance('2026-10-11', defaultPlan, settings)).toBe(900); // Sunday
  });

  it('leaves Friday and Saturday at the daily target, per the chosen model', () => {
    expect(dayAllowance('2026-10-09', defaultPlan, settings)).toBe(1500); // Friday
    expect(dayAllowance('2026-10-10', defaultPlan, settings)).toBe(1500); // Saturday
  });
});

describe('weeklyBudget', () => {
  it('sums the seven per-day allowances', () => {
    expect(weeklyBudget('2026-W41', defaultPlan, settings)).toBe(5 * 1500 + 2 * 900);
  });

  it('falls as no-dinner evenings are added, rather than redistributing', () => {
    const none = weeklyBudget('2026-W41', { noDinnerDays: [] }, settings);
    const one = weeklyBudget('2026-W41', { noDinnerDays: [3] }, settings);
    const two = weeklyBudget('2026-W41', defaultPlan, settings);
    expect(none).toBe(7 * 1500);
    expect(one).toBe(6 * 1500 + 900);
    expect(two).toBe(5 * 1500 + 2 * 900);
    expect(one).toBeLessThan(none);
    expect(two).toBeLessThan(one);
  });

  it('handles all seven evenings marked', () => {
    expect(weeklyBudget('2026-W41', { noDinnerDays: [1, 2, 3, 4, 5, 6, 7] }, settings))
      .toBe(7 * 900);
  });

  it('ignores duplicate entries in noDinnerDays', () => {
    expect(weeklyBudget('2026-W41', { noDinnerDays: [3, 3, 7] }, settings))
      .toBe(5 * 1500 + 2 * 900);
  });
});

describe('weeklyRemaining', () => {
  // The week's budget is 5 x 1500 + 2 x 900 = 9300.
  it('subtracts what was logged', () => {
    expect(weeklyRemaining('2026-W41', defaultPlan, settings, 6900)).toBe(2400);
  });

  it('goes negative on an overshoot instead of clamping', () => {
    expect(weeklyRemaining('2026-W41', defaultPlan, settings, 9600)).toBe(-300);
  });
});

describe('floorWarnings', () => {
  it('is empty when both allowances clear the floor', () => {
    expect(floorWarnings({ ...settings, calorieFloor: 800 })).toEqual([]);
  });

  it('flags the no-dinner allowance when it sits below the floor', () => {
    expect(floorWarnings(settings)).toEqual([
      { kind: 'noDinner', value: 900, floor: 1200 },
    ]);
  });

  it('does not flag an allowance that sits exactly on the floor', () => {
    // Strictly below is a warning; equal is not. Without this case, flipping
    // the comparison to <= leaves the whole suite green.
    expect(floorWarnings({ ...settings, calorieFloor: 900 })).toEqual([]);
    expect(floorWarnings({ ...settings, calorieFloor: 1500 })).toEqual([
      { kind: 'noDinner', value: 900, floor: 1500 },
    ]);
  });

  it('flags both allowances when both sit below the floor', () => {
    expect(floorWarnings({ ...settings, calorieFloor: 1600 })).toEqual([
      { kind: 'daily', value: 1500, floor: 1600 },
      { kind: 'noDinner', value: 900, floor: 1600 },
    ]);
  });
});
