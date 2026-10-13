import { describe, expect, it } from 'vitest';
import {
  daysUntil, gapToTrajectory, impliedWeeklyRate, isCycleComplete,
  trajectoryAt, weeklyIntermediateGoal, type TrajectorySettings,
} from '@/domain/trajectory';

// 37 days from 6 October to 12 November; 3.7 kg to lose; 0.1 kg per day.
const s: TrajectorySettings = {
  startDate: '2026-10-06',
  startWeight: 66,
  targetWeight: 62.3,
  goalDate: '2026-11-12',
};

describe('trajectoryAt', () => {
  it('returns the endpoints exactly', () => {
    expect(trajectoryAt('2026-10-06', s)).toBeCloseTo(66, 10);
    expect(trajectoryAt('2026-11-12', s)).toBeCloseTo(62.3, 10);
  });

  it('interpolates linearly', () => {
    expect(trajectoryAt('2026-10-16', s)).toBeCloseTo(65, 10); // 10 days x 0.1
  });

  it('clamps outside the window so the line never runs off', () => {
    expect(trajectoryAt('2026-09-01', s)).toBeCloseTo(66, 10);
    expect(trajectoryAt('2026-12-01', s)).toBeCloseTo(62.3, 10);
  });

  it('returns the start weight when start and goal are the same day', () => {
    const degenerate: TrajectorySettings = { ...s, goalDate: '2026-10-06' };
    expect(trajectoryAt('2026-10-06', degenerate)).toBeCloseTo(66, 10);
  });
});

describe('weeklyIntermediateGoal', () => {
  it('is the trajectory value on that week Sunday', () => {
    // 2026-W41 ends Sunday 11 October: 5 days in.
    expect(weeklyIntermediateGoal('2026-W41', s)).toBeCloseTo(trajectoryAt('2026-10-11', s), 10);
    expect(weeklyIntermediateGoal('2026-W41', s)).toBeCloseTo(65.5, 10);
  });
});

describe('impliedWeeklyRate', () => {
  it('is signed, and negative when the target is below the start', () => {
    expect(impliedWeeklyRate(s)).toBeCloseTo((-3.7 / 37) * 7, 10);
    expect(impliedWeeklyRate(s)).toBeLessThan(0);
  });

  it('is positive when the target is above the start', () => {
    expect(impliedWeeklyRate({ ...s, targetWeight: 69.7 })).toBeCloseTo((3.7 / 37) * 7, 10);
  });

  it('is zero when start and goal coincide', () => {
    expect(impliedWeeklyRate({ ...s, goalDate: '2026-10-06' })).toBe(0);
  });
});

describe('gapToTrajectory', () => {
  it('is negative when ahead of the line', () => {
    // On 16 October the line is 65.0; weighing 64.6 is 0.4 kg ahead.
    expect(gapToTrajectory(64.6, '2026-10-16', s)).toBeCloseTo(-0.4, 10);
  });

  it('is positive when behind', () => {
    expect(gapToTrajectory(65.6, '2026-10-16', s)).toBeCloseTo(0.6, 10);
  });
});

describe('daysUntil / isCycleComplete', () => {
  it('counts down to the goal date', () => {
    expect(daysUntil('2026-11-12', '2026-10-06')).toBe(37);
    expect(daysUntil('2026-11-12', '2026-11-12')).toBe(0);
  });

  it('goes negative past the goal and reports completion the day after', () => {
    expect(daysUntil('2026-11-12', '2026-11-13')).toBe(-1);
    expect(isCycleComplete('2026-11-12', '2026-11-12')).toBe(false);
    expect(isCycleComplete('2026-11-12', '2026-11-13')).toBe(true);
  });
});
