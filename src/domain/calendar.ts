import type { IsoDate, IsoWeek, Weekday } from './types';

const DAY_MS = 86_400_000;

/** Parsed at UTC noon: a ±12h shift can never land on another calendar date. */
export function parseIsoDate(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1, 12));
}

/**
 * Only for `Date`s produced by `parseIsoDate`, which sit at UTC noon. For any
 * other instant the UTC day can differ from the local one — use `todayIn` to
 * get today's date from an instant.
 */
export function formatUtcNoonDate(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return formatUtcNoonDate(new Date(parseIsoDate(d).getTime() + n * DAY_MS));
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
  const days = (dt.getTime() - jan1) / DAY_MS;
  // ceil((days + 1) / 7), NOT round(days / 7) + 1. Let k be the day-of-year
  // index of the ISO year's first Thursday; the Thursday of week N sits at
  // k + 7(N-1), so round(days / 7) + 1 yields N + round(k / 7) — correct only
  // while k <= 3. For k in {4, 5, 6}, i.e. whenever 1 January is a Friday,
  // Saturday or Sunday (three years in seven), every week in that year came
  // out one too high and isoWeekOf stopped inverting datesOfIsoWeek.
  const week = Math.ceil((days + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function datesOfIsoWeek(w: IsoWeek): IsoDate[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(w);
  if (match === null) {
    throw new Error(`Not an ISO week key (expected YYYY-Www): ${JSON.stringify(w)}`);
  }
  const [, yearPart, weekPart] = match;
  const year = Number(yearPart);
  const week = Number(weekPart);
  // 53 is the most any ISO year has; rejecting a 53rd week in a 52-week year
  // would need that year's length, which is more than this guard is for.
  if (week < 1 || week > 53) {
    throw new Error(`ISO week number out of range in ${JSON.stringify(w)}: ${week}`);
  }
  // 4 January is always in ISO week 1.
  const jan4 = Date.UTC(year, 0, 4, 12);
  const jan4Weekday = weekdayOf(formatUtcNoonDate(new Date(jan4)));
  const week1Monday = jan4 - (jan4Weekday - 1) * DAY_MS;
  const monday = week1Monday + (week - 1) * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => formatUtcNoonDate(new Date(monday + i * DAY_MS)));
}

/** True when the runtime's Intl accepts `tz` as a time zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The only function in the codebase that turns an instant into a date. */
export function todayIn(tz: string, now: Date = new Date()): IsoDate {
  // Read the parts by type rather than trusting a locale's layout.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  // A missing part would yield a malformed date that flows into every
  // comparison, so fail loudly instead.
  const part = (type: string): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`Intl omitted the "${type}" part for ${tz}`);
    return value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
}
