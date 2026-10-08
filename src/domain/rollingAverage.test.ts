import { describe, expect, it } from 'vitest';
import { rollingAverage, type WeighIn } from '@/domain/rollingAverage';

const w = (date: string, kg: number): WeighIn => ({ date, kg });

describe('rollingAverage', () => {
  it('returns null below the three weigh-in minimum', () => {
    expect(rollingAverage([], '2026-10-06')).toBeNull();
    expect(rollingAverage([w('2026-10-06', 62)], '2026-10-06')).toBeNull();
    expect(rollingAverage([w('2026-10-05', 62), w('2026-10-06', 62.4)], '2026-10-06')).toBeNull();
  });

  it('averages the trailing seven days inclusive', () => {
    const data = [w('2026-10-04', 63), w('2026-10-05', 62.5), w('2026-10-06', 62)];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo(62.5, 10);
  });

  it('excludes weigh-ins older than the seven-day window', () => {
    // "Trailing seven calendar days inclusive" means {onDate-6 … onDate}, so a
    // weigh-in exactly 7 days back is OUTSIDE the window, not on its edge.
    const data = [
      w('2026-09-29', 70),   // 7 days before — outside
      w('2026-09-30', 63),   // 6 days before — inside
      w('2026-10-05', 62.5),
      w('2026-10-06', 62),
    ];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo((63 + 62.5 + 62) / 3, 10);
  });

  it('excludes weigh-ins after the reference date', () => {
    const data = [
      w('2026-10-04', 63), w('2026-10-05', 62.5), w('2026-10-06', 62),
      w('2026-10-07', 10), // the future must not count
    ];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo(62.5, 10);
  });

  it('tolerates gaps and unsorted input', () => {
    const data = [w('2026-10-06', 62), w('2026-10-01', 63), w('2026-10-03', 62.5)];
    expect(rollingAverage(data, '2026-10-06')).toBeCloseTo((62 + 63 + 62.5) / 3, 10);
  });

  it('spans the 25 October 2026 DST change unchanged', () => {
    const data = [w('2026-10-23', 61.8), w('2026-10-25', 61.6), w('2026-10-27', 61.4)];
    expect(rollingAverage(data, '2026-10-27')).toBeCloseTo(61.6, 10);
  });
});
