import { diffDays } from './calendar';
import { MIN_WEIGH_INS_FOR_AVERAGE, type IsoDate } from './types';

export interface WeighIn {
  date: IsoDate;
  kg: number;
}

/**
 * Mean of the weigh-ins in the trailing seven calendar days, inclusive of
 * `onDate`. Returns null below MIN_WEIGH_INS_FOR_AVERAGE, so the UI can say
 * "pas encore assez de pesees" rather than draw a misleading line.
 */
export function rollingAverage(weighIns: WeighIn[], onDate: IsoDate): number | null {
  const window = weighIns.filter((entry) => {
    const age = diffDays(entry.date, onDate);
    return age >= 0 && age < 7;
  });
  if (window.length < MIN_WEIGH_INS_FOR_AVERAGE) return null;
  const total = window.reduce((sum, entry) => sum + entry.kg, 0);
  return total / window.length;
}
