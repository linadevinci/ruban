import { describe, expect, it } from 'vitest';
import {
  addDays, datesOfIsoWeek, diffDays, formatIsoDate, isoWeekOf,
  parseIsoDate, todayIn, weekdayOf,
} from '@/domain/calendar';

describe('parseIsoDate / formatIsoDate', () => {
  it('parses at UTC noon so no shift crosses a date boundary', () => {
    expect(parseIsoDate('2026-10-06').toISOString()).toBe('2026-10-06T12:00:00.000Z');
  });

  it('round-trips', () => {
    expect(formatIsoDate(parseIsoDate('2026-11-12'))).toBe('2026-11-12');
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
});
