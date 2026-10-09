import { describe, expect, it } from 'vitest';
import {
  formatDuration, formatPace, paceSecondsPerKm, weeklyRunSummary, type RunLike,
} from '@/domain/running';

const run = (date: string, distanceKm: number, durationS: number): RunLike =>
  ({ date, distanceKm, durationS });

describe('paceSecondsPerKm', () => {
  it('divides duration by distance', () => {
    expect(paceSecondsPerKm(5, 1500)).toBe(300); // 5:00 /km
  });

  it('returns null for a zero or negative distance instead of Infinity', () => {
    expect(paceSecondsPerKm(0, 1500)).toBeNull();
    expect(paceSecondsPerKm(-1, 1500)).toBeNull();
  });
});

describe('formatPace', () => {
  it('formats as m:ss', () => {
    expect(formatPace(300)).toBe('5:00');
    expect(formatPace(324)).toBe('5:24');
    expect(formatPace(305.6)).toBe('5:06');
  });

  it('rolls 59.6 seconds up into the next minute', () => {
    expect(formatPace(359.6)).toBe('6:00');
  });
});

describe('formatDuration', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatDuration(1720)).toBe('28:40');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('weeklyRunSummary', () => {
  it('counts only runs inside the week', () => {
    const runs = [
      run('2026-10-04', 6, 2100),   // Sunday of W40 — excluded
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5.2, 1600),
      run('2026-10-12', 7, 2400),   // Monday of W42 — excluded
    ];
    const summary = weeklyRunSummary(runs, '2026-W41', 5);
    expect(summary.sessions).toBe(2);
    expect(summary.totalKm).toBeCloseTo(10.2, 10);
    expect(summary.target).toBe(5);
  });

  it('averages pace over total distance and total time, not over runs', () => {
    // Unequal distances, so the two algorithms disagree: total over total is
    // 3390 / 10 = 339, while a mean of the per-run paces (240 and 350) is 295.
    const runs = [run('2026-10-05', 1, 240), run('2026-10-06', 9, 3150)];
    const summary = weeklyRunSummary(runs, '2026-W41', 5);
    expect(summary.averagePaceSecondsPerKm).toBeCloseTo(339, 10);
  });

  it('reports an empty week without dividing by zero', () => {
    expect(weeklyRunSummary([], '2026-W41', 5)).toEqual({
      sessions: 0, target: 5, totalKm: 0, totalDurationS: 0,
      averagePaceSecondsPerKm: null,
    });
  });

  it('totals the duration of the in-week runs only', () => {
    const runs = [
      run('2026-10-04', 6, 2100),   // Sunday of W40 — excluded
      run('2026-10-05', 5, 1500),
      run('2026-10-06', 5.2, 1600),
      run('2026-10-12', 7, 2400),   // Monday of W42 — excluded
    ];
    expect(weeklyRunSummary(runs, '2026-W41', 5).totalDurationS).toBe(3100);
  });

  it('counts two runs on the same day as two sessions', () => {
    const runs = [run('2026-10-06', 5, 1500), run('2026-10-06', 3, 900)];
    expect(weeklyRunSummary(runs, '2026-W41', 5).sessions).toBe(2);
  });
});
