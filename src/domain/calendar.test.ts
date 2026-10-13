import { describe, expect, it, vi } from 'vitest';
import {
  addDays, datesOfIsoWeek, diffDays, formatUtcNoonDate, isIsoDate, isoWeekOf, isValidTimeZone,
  parseIsoDate, todayIn, weekdayOf,
} from '@/domain/calendar';

describe('parseIsoDate / formatUtcNoonDate', () => {
  it('rejects malformed input rather than inventing a date', () => {
    for (const bad of ['', 'garbage', '2026-10', '2026-1-1']) {
      expect(() => parseIsoDate(bad), bad).toThrow(/Not an ISO date/);
    }
  });

  it('parses at UTC noon so no shift crosses a date boundary', () => {
    expect(parseIsoDate('2026-10-06').toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });

  it('round-trips', () => {
    expect(formatUtcNoonDate(parseIsoDate('2026-11-12'))).toBe('2026-11-12');
  });
});

describe('weekdayOf', () => {
  it('uses ISO numbering with Monday as 1', () => {
    expect(weekdayOf('2026-10-05')).toBe(1); // Monday
    expect(weekdayOf('2026-10-06')).toBe(2); // Tuesday
    expect(weekdayOf('2026-10-11')).toBe(7); // Sunday
  });
});

describe('addDays / diffDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-10-06', '2026-11-12')).toBe(37);
    expect(diffDays('2026-11-12', '2026-10-06')).toBe(-37);
  });

  it('is unaffected by the 25 October 2026 DST change', () => {
    // A 25-hour local day must still be exactly one calendar day.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('isoWeekOf', () => {
  it('keys the spec date to 2026-W41', () => {
    expect(isoWeekOf('2026-10-06')).toBe('2026-W41');
  });

  it('puts Sunday in the week that began the preceding Monday', () => {
    expect(isoWeekOf('2026-10-11')).toBe('2026-W41');
    expect(isoWeekOf('2026-10-12')).toBe('2026-W42');
  });

  it('handles a year boundary where week 1 starts in December', () => {
    // 1 January 2026 is a Thursday, so ISO week 1 of 2026 begins 29 December 2025.
    expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
    expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
  });

  it('numbers 2027, whose 1 January is a Friday, from week 1', () => {
    // 1 January 2027 is a Friday, so it belongs to 2026-W53 and ISO week 1 of
    // 2027 begins Monday 4 January. round(days / 7) + 1 made every 2027 week
    // one too high.
    expect(isoWeekOf('2026-12-31')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-04')).toBe('2027-W01');
    expect(isoWeekOf('2027-12-31')).toBe('2027-W52');
    expect(isoWeekOf('2028-01-01')).toBe('2027-W52');
  });
});

describe('datesOfIsoWeek', () => {
  it('returns seven dates, Monday first', () => {
    expect(datesOfIsoWeek('2026-W41')).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
      '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });

  it('is the inverse of isoWeekOf for every date it returns', () => {
    for (const d of datesOfIsoWeek('2026-W44')) {
      expect(isoWeekOf(d)).toBe('2026-W44');
    }
  });

  it('rejects a key that is not YYYY-Www instead of throwing from toISOString', () => {
    expect(() => datesOfIsoWeek('garbage')).toThrow(/garbage/);
    expect(() => datesOfIsoWeek('2026-W4')).toThrow(/2026-W4/);
    expect(() => datesOfIsoWeek('2026-41')).toThrow(/2026-41/);
  });

  it('rejects a week number outside 1-53', () => {
    expect(() => datesOfIsoWeek('2026-W00')).toThrow(/out of range/);
    expect(() => datesOfIsoWeek('2026-W54')).toThrow(/out of range/);
  });
});

describe('isoWeekOf and datesOfIsoWeek invert each other', () => {
  it('holds for every date from 2026-01-01 to 2029-12-31', () => {
    // A fixture table for one year cannot protect this: the broken week
    // formula was right in 2026 and wrong for all 728 days of 2027-2028.
    const span = diffDays('2026-01-01', '2029-12-31');
    expect(span).toBe(1460); // a bounded loop: a broken addDays must not hang it
    const failures: string[] = [];
    for (let i = 0; i <= span; i += 1) {
      const date = addDays('2026-01-01', i);
      const week = isoWeekOf(date);
      if (!datesOfIsoWeek(week).includes(date)) failures.push(`${date} -> ${week}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('todayIn', () => {
  it('reads the date in the given zone, not UTC', () => {
    // 22:30 UTC is already the next day in Paris (UTC+2 in summer).
    const instant = new Date('2026-07-14T22:30:00Z');
    expect(todayIn('Europe/Paris', instant)).toBe('2026-07-15');
    expect(todayIn('UTC', instant)).toBe('2026-07-14');
  });

  it('is correct on both sides of the 25 October 2026 DST change', () => {
    // Paris is UTC+2 before 01:00 UTC that day and UTC+1 after.
    expect(todayIn('Europe/Paris', new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/Paris', new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
  });

  it('throws rather than returning a malformed date when a part is omitted', () => {
    const RealFormat = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locale?: string | string[], options?: Intl.DateTimeFormatOptions,
    ) {
      const real = new RealFormat(locale, options);
      return {
        formatToParts: (date?: Date | number) => real.formatToParts(date).filter((p) => p.type !== 'day'),
      } as Intl.DateTimeFormat;
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      expect(() => todayIn('UTC', new Date('2026-07-14T12:00:00Z'))).toThrow(/day/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('parseIsoDate real-date check', () => {
  it('rejects dates that are well-formed but not real, and keeps genuine leap days', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2027-02-29']) {
      expect(() => parseIsoDate(bad), bad).toThrow(/Not a real calendar date/);
    }
    expect(formatUtcNoonDate(parseIsoDate('2028-02-29'))).toBe('2028-02-29');
  });
});

describe('isIsoDate', () => {
  it('accepts real dates and rejects empty, five-digit-year and unreal ones', () => {
    expect(isIsoDate('2026-11-12')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['', '12026-01-01', '2026-02-31']) {
      expect(isIsoDate(bad), bad).toBe(false);
    }
  });
});

describe('isValidTimeZone', () => {
  it('accepts a real zone and rejects an unknown one', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
