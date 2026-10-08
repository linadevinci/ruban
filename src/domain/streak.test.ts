import { describe, expect, it } from 'vitest';
import { canUseJoker, currentStreak, isCovered, type DayCoverage } from '@/domain/streak';

const validated = (date: string): DayCoverage => ({ date, validatedAt: '2026-10-06T21:00:00Z', jokered: false });
const jokered = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: true });
const failed = (date: string): DayCoverage => ({ date, validatedAt: null, jokered: false });

describe('isCovered', () => {
  it('counts validated and jokered days, not failed ones', () => {
    expect(isCovered(validated('2026-10-06'))).toBe(true);
    expect(isCovered(jokered('2026-10-06'))).toBe(true);
    expect(isCovered(failed('2026-10-06'))).toBe(false);
  });
});

describe('currentStreak', () => {
  const start = '2026-10-01';

  it('is zero with no days', () => {
    expect(currentStreak([], '2026-10-06', start)).toBe(0);
  });

  it('counts a run ending today', () => {
    const days = [validated('2026-10-04'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(3);
  });

  it('counts through yesterday when today is not yet validated', () => {
    const days = [validated('2026-10-04'), validated('2026-10-05')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('is zero when neither today nor yesterday is covered', () => {
    const days = [validated('2026-10-03'), validated('2026-10-04')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(0);
  });

  it('survives a spent joker in the middle of the run', () => {
    const days = [
      validated('2026-10-03'), jokered('2026-10-04'),
      validated('2026-10-05'), validated('2026-10-06'),
    ];
    expect(currentStreak(days, '2026-10-06', start)).toBe(4);
  });

  it('breaks on a failed day', () => {
    const days = [
      validated('2026-10-03'), failed('2026-10-04'),
      validated('2026-10-05'), validated('2026-10-06'),
    ];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('breaks on a missing day, not just an explicitly failed one', () => {
    const days = [validated('2026-10-03'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });

  it('never counts before startDate', () => {
    const days = [
      validated('2026-09-29'), validated('2026-09-30'),
      validated('2026-10-01'), validated('2026-10-02'),
    ];
    expect(currentStreak(days, '2026-10-02', '2026-10-01')).toBe(2);
  });

  it('counts the 25 October 2026 DST day as exactly one day', () => {
    const days = [
      validated('2026-10-23'), validated('2026-10-24'),
      validated('2026-10-25'), validated('2026-10-26'),
    ];
    expect(currentStreak(days, '2026-10-26', '2026-10-01')).toBe(4);
  });

  it('ignores duplicate rows for the same date', () => {
    const days = [validated('2026-10-05'), validated('2026-10-05'), validated('2026-10-06')];
    expect(currentStreak(days, '2026-10-06', start)).toBe(2);
  });
});

describe('canUseJoker', () => {
  const base = {
    today: '2026-10-08',
    startDate: '2026-10-01',
    coverage: failed('2026-10-08'),
    weekPlanJokerUsedOn: null,
  };

  it('allows it on an uncovered today', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08' })).toBe(true);
  });

  it('allows it on an uncovered yesterday', () => {
    expect(canUseJoker({ ...base, date: '2026-10-07', coverage: failed('2026-10-07') })).toBe(true);
  });

  it('refuses a day further back, which would be retroactive self-deception', () => {
    expect(canUseJoker({ ...base, date: '2026-10-06', coverage: failed('2026-10-06') })).toBe(false);
  });

  it('refuses a future date', () => {
    expect(canUseJoker({ ...base, date: '2026-10-09', coverage: failed('2026-10-09') })).toBe(false);
  });

  it('refuses a day that is already covered', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: validated('2026-10-08') })).toBe(false);
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: jokered('2026-10-08') })).toBe(false);
  });

  it('refuses when that date own ISO week has already spent its joker', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', weekPlanJokerUsedOn: '2026-10-05' })).toBe(false);
  });

  it('refuses a date before startDate', () => {
    expect(canUseJoker({
      ...base, today: '2026-10-01', date: '2026-09-30',
      coverage: failed('2026-09-30'), startDate: '2026-10-01',
    })).toBe(false);
  });

  it('allows yesterday across a week boundary, judged by that date own week', () => {
    // Monday 12 October; yesterday was Sunday 11 October, in 2026-W41.
    // W41 has not spent its joker even though W42 might have.
    expect(canUseJoker({
      ...base, today: '2026-10-12', date: '2026-10-11',
      coverage: failed('2026-10-11'), weekPlanJokerUsedOn: null,
    })).toBe(true);
  });

  it('allows a date with no coverage row, since nothing logged means uncovered', () => {
    expect(canUseJoker({ ...base, date: '2026-10-08', coverage: undefined })).toBe(true);
  });
});
