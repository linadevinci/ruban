import { parseIsoDate } from '@/domain/calendar';
import type { IsoDate } from '@/domain/types';

const NARROW_NBSP = ' ';
const MINUS = '−';

export function kg(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** Negative is ahead of the trajectory; positive is behind. */
export function signedKg(delta: number): string {
  if (Math.abs(delta) < 0.05) return 'pile sur la trajectoire';
  const magnitude = kg(Math.abs(delta));
  return delta < 0 ? `${magnitude} kg d'avance` : `${magnitude} kg de retard`;
}

export function kcal(value: number): string {
  const grouped = Math.abs(Math.round(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return value < 0 ? `${MINUS}${grouped}` : grouped;
}

export function longDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(parseIsoDate(date));
}

export function weekdayShort(date: IsoDate): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' })
    .format(parseIsoDate(date))
    .replace('.', '');
}

/** French puts zero in the singular. */
export function plural(n: number, one: string, many: string): string {
  return Math.abs(n) < 2 ? one : many;
}
