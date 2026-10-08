import type { IsoDate, IsoWeek, Weekday } from './types';

const DAY_MS = 86_400_000;

/** Parsed at UTC noon: a ±12h shift can never land on another calendar date. */
export function parseIsoDate(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1, 12));
}

export function formatIsoDate(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return formatIsoDate(new Date(parseIsoDate(d).getTime() + n * DAY_MS));
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}

export function weekdayOf(d: IsoDate): Weekday {
  const js = parseIsoDate(d).getUTCDay();
  return (js === 0 ? 7 : js) as Weekday;
}

export function isoWeekOf(d: IsoDate): IsoWeek {
  const dt = parseIsoDate(d);
  // Step to the Thursday of this ISO week; its calendar year is the ISO year.
  dt.setUTCDate(dt.getUTCDate() + 4 - weekdayOf(d));
  const year = dt.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1, 12);
  const week = Math.round((dt.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function datesOfIsoWeek(w: IsoWeek): IsoDate[] {
  const [yearPart, weekPart] = w.split('-W');
  const year = Number(yearPart);
  const week = Number(weekPart);
  // 4 January is always in ISO week 1.
  const jan4 = Date.UTC(year, 0, 4, 12);
  const jan4Weekday = weekdayOf(formatIsoDate(new Date(jan4)));
  const week1Monday = jan4 - (jan4Weekday - 1) * DAY_MS;
  const monday = week1Monday + (week - 1) * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => formatIsoDate(new Date(monday + i * DAY_MS)));
}

/** The only function in the codebase that turns an instant into a date. */
export function todayIn(tz: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}
