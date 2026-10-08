import { datesOfIsoWeek } from './calendar';
import type { IsoWeek, Run } from './types';

export type RunLike = Pick<Run, 'date' | 'distanceKm' | 'durationS'>;

export interface WeeklyRunSummary {
  sessions: number;
  target: number;
  totalKm: number;
  averagePaceSecondsPerKm: number | null;
}

export function paceSecondsPerKm(distanceKm: number, durationS: number): number | null {
  if (distanceKm <= 0) return null;
  return durationS / distanceKm;
}

export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function weeklyRunSummary(
  runs: RunLike[],
  week: IsoWeek,
  sessionsTarget: number,
): WeeklyRunSummary {
  const dates = new Set(datesOfIsoWeek(week));
  const inWeek = runs.filter((r) => dates.has(r.date));
  const totalKm = inWeek.reduce((sum, r) => sum + r.distanceKm, 0);
  const totalS = inWeek.reduce((sum, r) => sum + r.durationS, 0);
  return {
    sessions: inWeek.length,
    target: sessionsTarget,
    totalKm,
    averagePaceSecondsPerKm: paceSecondsPerKm(totalKm, totalS),
  };
}
