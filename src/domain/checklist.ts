import { dayAllowance, type BudgetSettings } from './budget';
import { weekdayOf } from './calendar';
import {
  DEFAULT_NO_DINNER_DAYS, DEFAULT_RUN_DAYS,
  type ChecklistItemId, type DayLog, type IsoDate, type Settings, type WeekPlan,
} from './types';

export type ChecklistPlan = Pick<WeekPlan, 'runDays' | 'noDinnerDays'>;

export type ChecklistSettings = BudgetSettings &
  Pick<Settings, 'stepTarget' | 'waterTarget'>;

export interface ChecklistItem {
  id: ChecklistItemId;
  satisfied: boolean;
}

export interface DayEvaluation {
  date: IsoDate;
  plan: ChecklistPlan;
  settings: ChecklistSettings;
  log: DayLog | undefined;
  runCount: number;
  calorieTotal: number;
  calorieEntryCount: number;
}

/**
 * The plan a week is judged by, without persisting anything. getOrCreateWeekPlan
 * writes on read, which fabricates a snapshot for a past week that was never
 * planned; a screen that merely looks at a week uses this instead.
 */
export function effectiveWeekPlan(plan: WeekPlan | undefined): ChecklistPlan {
  return plan ?? {
    runDays: [...DEFAULT_RUN_DAYS],
    noDinnerDays: [...DEFAULT_NO_DINNER_DAYS],
  };
}

/** Stable render order; the UI never re-sorts. */
const ITEM_ORDER: ChecklistItemId[] = ['course', 'calories', 'no_dinner', 'steps', 'water'];

export function applicableItems(date: IsoDate, plan: ChecklistPlan): ChecklistItemId[] {
  const weekday = weekdayOf(date);
  return ITEM_ORDER.filter((id) => {
    if (id === 'course') return plan.runDays.includes(weekday);
    if (id === 'no_dinner') return plan.noDinnerDays.includes(weekday);
    return true;
  });
}

function isSatisfied(id: ChecklistItemId, input: DayEvaluation): boolean {
  const { log, settings, plan, date } = input;
  switch (id) {
    case 'course':
      return input.runCount > 0 || log?.ticks.course === true;
    case 'calories': {
      const override = log?.ticks.calories;
      if (override !== undefined) return override;
      if (input.calorieEntryCount === 0) return false;
      return input.calorieTotal <= dayAllowance(date, plan, settings);
    }
    case 'no_dinner':
      return log?.ticks.no_dinner === true;
    case 'steps':
      return (log?.steps ?? 0) >= settings.stepTarget;
    case 'water':
      return (log?.waterGlasses ?? 0) >= settings.waterTarget;
  }
}

export function evaluateChecklist(input: DayEvaluation): ChecklistItem[] {
  return applicableItems(input.date, input.plan).map((id) => ({
    id,
    satisfied: isSatisfied(id, input),
  }));
}

/** An empty list is never a validated day. */
export function isDayValidated(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.satisfied);
}
