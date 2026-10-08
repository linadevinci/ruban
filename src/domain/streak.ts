import { addDays, diffDays } from './calendar';
import type { IsoDate } from './types';

export interface DayCoverage {
  date: IsoDate;
  validatedAt: string | null;
  jokered: boolean;
}

export interface JokerCheck {
  date: IsoDate;
  today: IsoDate;
  startDate: IsoDate;
  /** Coverage for `date`, if a row exists. Absent means nothing logged yet. */
  coverage: DayCoverage | undefined;
  /** `jokerUsedOn` from the week plan of `date` own ISO week. */
  weekPlanJokerUsedOn: IsoDate | null;
}

export function isCovered(day: DayCoverage): boolean {
  return day.validatedAt !== null || day.jokered;
}

/**
 * Consecutive covered days ending at today, or at yesterday when today is
 * not covered yet, and never reaching before startDate.
 */
export function currentStreak(
  days: DayCoverage[],
  today: IsoDate,
  startDate: IsoDate,
): number {
  const covered = new Set<IsoDate>();
  for (const day of days) {
    if (isCovered(day)) covered.add(day.date);
  }

  let cursor: IsoDate;
  if (covered.has(today)) cursor = today;
  else if (covered.has(addDays(today, -1))) cursor = addDays(today, -1);
  else return 0;

  let count = 0;
  while (covered.has(cursor) && diffDays(startDate, cursor) >= 0) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function canUseJoker(input: JokerCheck): boolean {
  const age = diffDays(input.date, input.today);
  if (age < 0 || age > 1) return false;
  if (diffDays(input.startDate, input.date) < 0) return false;
  if (input.weekPlanJokerUsedOn !== null) return false;
  if (input.coverage !== undefined && isCovered(input.coverage)) return false;
  return true;
}
