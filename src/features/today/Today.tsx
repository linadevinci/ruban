import { useEffect, useRef, useState } from 'react';
import { updateDayLog, updateWeekPlan } from '@/db/repos';
import { isoWeekOf } from '@/domain/calendar';
import type { TickableItemId } from '@/domain/types';
import { Checklist } from '@/features/today/Checklist';
import { StreakCard } from '@/features/today/StreakCard';
import { syncStamps } from '@/features/today/stamps';
import { useToday } from '@/features/today/useToday';
import { Card } from '@/ui/Card';
import { Confetti } from '@/ui/Confetti';
import { kcal, longDate } from '@/ui/format';
import { playFanfare, playTick } from '@/ui/reward';
import { Stepper } from '@/ui/Stepper';
import '@/features/today/today.css';

/** How long the shower runs before the screen goes quiet again. */
const CELEBRATION_MS = 2600;

/**
 * kcal() is this project's thousands grouper (8000 becomes "8 000" with a
 * narrow no-break space), and the French number rules apply to a step target
 * as much as to a calorie count. Aliased rather than reimplemented, because a
 * second grouper would be a second set of rules to keep in step.
 */
const grouped = kcal;

type CountEntry =
  | { kind: 'clear' }
  | { kind: 'count'; value: number }
  | { kind: 'reject' };

/**
 * What a keystroke in a count field means. inputMode is a keyboard hint, not a
 * constraint: it does nothing on a desktop keyboard and nothing against a
 * paste. Number('abc') is NaN, and a NaN in dayLogs.steps makes
 * `NaN >= stepTarget` false for that day forever while rendering as "NaN", so
 * anything that is not a count of zero or more is ignored rather than stored -
 * the same guard Onboarding puts on its own number fields.
 */
function readCount(raw: string): CountEntry {
  const text = raw.trim();
  if (text === '') return { kind: 'clear' };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return { kind: 'reject' };
  return { kind: 'count', value };
}

export function Today({ userId }: { userId: string }) {
  const view = useToday(userId);
  const [celebrating, setCelebrating] = useState(false);
  const celebrationTimer = useRef(0);

  // Cleared on unmount only: clearing it on every effect run would cut the
  // shower short on the very re-render the stamp itself causes.
  useEffect(() => () => { window.clearTimeout(celebrationTimer.current); }, []);

  // Read out of the view so the effect below can depend on the values it
  // actually uses rather than on the identity of a freshly built object.
  const date = view?.date;
  const validated = view?.validated;
  const bonusFiredAt = view?.log.bonusFiredAt;
  const sound = view?.settings.soundEnabled ?? false;

  // Stamps validation and fires the one-time bonus whenever the view says the
  // day is complete. The write belongs here and never in useToday's querier,
  // where Dexie rejects any readwrite transaction.
  useEffect(() => {
    if (date === undefined || validated === undefined) return;
    // No cancellation flag on the result, deliberately. Firing twice is
    // already impossible: stampDayLog decides inside one transaction from the
    // stored row, so of any number of calls in flight exactly one reports
    // fireBonus (Task 8). What a flag would add is a way to LOSE it. The
    // report arrives after the write, bonusFiredAt is then stamped forever,
    // and dropping the report because this effect was cleaned up mid-flight -
    // an item unticked in the moment between the call and its answer - would
    // mean the celebration never shows for that day again. The leak actually
    // worth guarding is the timeout, which the unmount effect above clears.
    void syncStamps(userId, { date, validated }).then((result) => {
      if (!result.fireBonus) return;
      playFanfare(sound);
      setCelebrating(true);
      window.clearTimeout(celebrationTimer.current);
      celebrationTimer.current = window.setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    });
  }, [userId, date, validated, bonusFiredAt, sound]);

  if (!view) return <p>{'Un instant\u2026'}</p>;

  const toggle = async (id: TickableItemId, next: boolean) => {
    playTick(sound);
    // Keyed off the date, never off view.log.id, which is the empty string on a
    // day with no stored row yet.
    await updateDayLog(userId, view.date, { ticks: { [id]: next } });
  };

  const spendJoker = async () => {
    await updateDayLog(userId, view.date, { jokered: true });
    // Rule 6: the week that holds the joker is the EXCUSED date's week, not
    // whatever week today falls in. ISO weeks start on Monday, so on a Sunday
    // the two differ - the Sunday belongs to the week that is closing.
    await updateWeekPlan(userId, isoWeekOf(view.date), { jokerUsedOn: view.date });
  };

  const setSteps = (raw: string) => {
    const entry = readCount(raw);
    if (entry.kind === 'reject') return;
    void updateDayLog(userId, view.date, {
      steps: entry.kind === 'clear' ? null : entry.value,
    });
  };

  return (
    <div className="today">
      <Confetti active={celebrating} />

      <StreakCard
        streak={view.streak}
        daysLeft={view.daysLeft}
        jokerAvailable={view.jokerAvailable}
        onUseJoker={spendJoker}
      />

      <Card laced>
        <h1 className="today__date">{longDate(view.date)}</h1>
        <Checklist items={view.items} onToggle={toggle} />

        <div className="today__amount">
          <span className="today__amountrow">
            <label className="today__amountname" htmlFor="today-steps">Pas</label>
            <span className="today__amounthint">
              {`\u00b7 objectif ${grouped(view.settings.stepTarget)}`}
            </span>
          </span>
          <input
            id="today-steps"
            className="today__steps"
            aria-label="Pas"
            inputMode="numeric"
            value={view.log.steps ?? ''}
            onChange={(event) => setSteps(event.target.value)}
          />
        </div>

        <div className="today__amount">
          <span className="today__amountrow">
            <span className="today__amountname">Eau</span>
            <span className="today__amounthint">
              {`\u00b7 objectif ${grouped(view.settings.waterTarget)}`}
            </span>
          </span>
          <Stepper
            label="Eau"
            value={view.log.waterGlasses ?? 0}
            min={0}
            max={20}
            step={1}
            onChange={(next) => {
              playTick(sound);
              void updateDayLog(userId, view.date, { waterGlasses: next });
            }}
          />
        </div>

        {/* The stamp, not the live evaluation: spec 4.3 makes validatedAt a
            fact about what happened, so a target raised later - or a tick
            taken back - cannot un-validate a day that earned it. The live
            `validated` is here too, for the instant before the stamp lands. */}
        {(view.log.validatedAt !== null || view.validated) && (
          <p className="today__done">Journée validée.</p>
        )}
      </Card>

      <Card>
        <div className="today__week" data-testid="week-remaining">
          <span className="label">Reste cette semaine</span>
          <span className="today__weeknum">{kcal(view.weeklyRemaining)} kcal</span>
        </div>
      </Card>
    </div>
  );
}
