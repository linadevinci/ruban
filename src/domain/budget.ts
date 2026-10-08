import { datesOfIsoWeek, weekdayOf } from './calendar';
import type { IsoDate, IsoWeek, Settings, WeekPlan } from './types';

export type BudgetPlan = Pick<WeekPlan, 'noDinnerDays'>;
export type BudgetSettings = Pick<
  Settings,
  'dailyCalorieTarget' | 'noDinnerAllowance' | 'calorieFloor'
>;

export interface FloorWarning {
  kind: 'daily' | 'noDinner';
  value: number;
  floor: number;
}

export function dayAllowance(
  date: IsoDate,
  plan: BudgetPlan,
  settings: BudgetSettings,
): number {
  return plan.noDinnerDays.includes(weekdayOf(date))
    ? settings.noDinnerAllowance
    : settings.dailyCalorieTarget;
}

/**
 * The sum of the week's seven per-day allowances. Marking an evening lowers
 * this total; the remaining days keep dailyCalorieTarget. No redistribution.
 */
export function weeklyBudget(
  week: IsoWeek,
  plan: BudgetPlan,
  settings: BudgetSettings,
): number {
  return datesOfIsoWeek(week).reduce(
    (total, date) => total + dayAllowance(date, plan, settings),
    0,
  );
}

/** Negative means an overshoot; the UI shows it rather than hiding it. */
export function weeklyRemaining(
  week: IsoWeek,
  plan: BudgetPlan,
  settings: BudgetSettings,
  consumedKcal: number,
): number {
  return weeklyBudget(week, plan, settings) - consumedKcal;
}

export function floorWarnings(settings: BudgetSettings): FloorWarning[] {
  const warnings: FloorWarning[] = [];
  if (settings.dailyCalorieTarget < settings.calorieFloor) {
    warnings.push({
      kind: 'daily',
      value: settings.dailyCalorieTarget,
      floor: settings.calorieFloor,
    });
  }
  if (settings.noDinnerAllowance < settings.calorieFloor) {
    warnings.push({
      kind: 'noDinner',
      value: settings.noDinnerAllowance,
      floor: settings.calorieFloor,
    });
  }
  return warnings;
}
