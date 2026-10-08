import { datesOfIsoWeek, diffDays } from './calendar';
import type { IsoDate, IsoWeek, Settings } from './types';

export type TrajectorySettings = Pick<
  Settings,
  'startDate' | 'startWeight' | 'targetWeight' | 'goalDate'
>;

/** Straight line from (startDate, startWeight) to (goalDate, targetWeight), clamped. */
export function trajectoryAt(date: IsoDate, settings: TrajectorySettings): number {
  const span = diffDays(settings.startDate, settings.goalDate);
  if (span <= 0) return settings.startWeight;
  const elapsed = Math.min(Math.max(diffDays(settings.startDate, date), 0), span);
  const delta = settings.targetWeight - settings.startWeight;
  return settings.startWeight + (delta * elapsed) / span;
}

/** This week's intermediate goal: the trajectory value on its Sunday. */
export function weeklyIntermediateGoal(week: IsoWeek, settings: TrajectorySettings): number {
  const dates = datesOfIsoWeek(week);
  const sunday = dates[6] ?? dates[0] ?? settings.startDate;
  return trajectoryAt(sunday, settings);
}

/** Signed kg per week the target implies. Shown at onboarding, never enforced. */
export function impliedWeeklyRate(settings: TrajectorySettings): number {
  const span = diffDays(settings.startDate, settings.goalDate);
  if (span <= 0) return 0;
  return ((settings.targetWeight - settings.startWeight) / span) * 7;
}

/** Negative = ahead of the line ("d'avance"); positive = behind ("de retard"). */
export function gapToTrajectory(
  rollingAvg: number,
  date: IsoDate,
  settings: TrajectorySettings,
): number {
  return rollingAvg - trajectoryAt(date, settings);
}

export function daysUntil(goalDate: IsoDate, today: IsoDate): number {
  return diffDays(today, goalDate);
}

export function isCycleComplete(goalDate: IsoDate, today: IsoDate): boolean {
  return diffDays(today, goalDate) < 0;
}
