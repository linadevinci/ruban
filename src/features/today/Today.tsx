import { useEffect, useRef, useState } from 'react';
import { spendJoker, updateDayLog } from '@/db/repos';
import type { IsoDate, TickableItemId } from '@/domain/types';
import { Checklist } from '@/features/today/Checklist';
import { StreakCard } from '@/features/today/StreakCard';
import { syncStamps } from '@/features/today/stamps';
import { useToday } from '@/features/today/useToday';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Confetti } from '@/ui/Confetti';
import { kcal, longDate } from '@/ui/format';
import { playFanfare, playTick } from '@/ui/reward';
import { Stepper } from '@/ui/Stepper';
import '@/features/today/today.css';

/** How long the shower runs before the screen goes quiet again. */
const CELEBRATION_MS = 2600;

/** The glass count the stepper offers, and the range a write is clamped to. */
const WATER_MIN = 0;
const WATER_MAX = 20;

/**
 * kcal() is this project's thousands grouper (8000 becomes "8 000" with a
 * narrow no-break space), and the French number rules apply to a step target
 * as much as to a calorie count. Aliased rather than reimplemented, because a
 * second grouper would be a second set of rules to keep in step.
 */
const grouped = kcal;

/**
 * What a refused write says. IndexedDB can refuse one - a quota refusal on a
 * near-full phone is the ordinary case - and until this landed a refusal left
 * no trace anywhere she could see it: the tick simply did not take, the step
 * count silently reverted, and the only record was a console she cannot open.
 * The shell goes to real trouble to say "Rien n'est perdu" when the database
 * will not OPEN, so a write that fails cannot stay mute.
 *
 * Two things the copy has to do. Say that THIS change did not land, so a tick
 * that sprang back is explained rather than mysterious; and not read as "your
 * day is gone", because nothing already stored has moved.
 */
const WRITE_FAILED = {
  title: 'Je n\u2019ai pas réussi à enregistrer ça.',
  line: 'Ta dernière modification n\u2019a pas été prise, mais le reste de ta journée est intact\u00a0: réessaie. Si ça insiste, il manque sans doute de la place sur ton téléphone.',
  dismiss: 'Fermer',
};

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
  /**
   * Set by any write that rejects, and cleared only when she dismisses it.
   * Deliberately not cleared by the next write that succeeds: a later write
   * landing says nothing about the one that did not, and clearing the notice
   * under her would take away the only explanation of the tick that sprang
   * back.
   */
  const [writeFailed, setWriteFailed] = useState(false);

  /**
   * What is being typed into the step field, while it is being typed, and null
   * the rest of the time - when the field simply shows the stored count.
   *
   * The field cannot be driven off the live query. Its value was then reset on
   * every re-render to the PRE-write count, which is one IndexedDB round-trip
   * behind the keystrokes, so any two keys struck inside one round-trip
   * collapsed: typing "8200" stored 0 and left "0" in the field, with nothing
   * to say so. Held as a draft rather than re-seeded from an effect, so the
   * stored count shows on the very first render and never lands mid-word.
   *
   * Stamped with the date it belongs to, because midnight moves the day under
   * a mounted screen and a draft is about one day's count.
   */
  const [stepsDraft, setStepsDraft] = useState<{ date: IsoDate; text: string } | null>(null);

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
    //
    // Caught like every other write on this screen: syncStamps stamps
    // validatedAt and bonusFiredAt, so a refusal here means the day she just
    // finished is not recorded as finished, which is the last thing to let
    // pass in silence.
    void syncStamps(userId, { date, validated }).then((result) => {
      if (!result.fireBonus) return;
      playFanfare(sound);
      setCelebrating(true);
      window.clearTimeout(celebrationTimer.current);
      celebrationTimer.current = window.setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    }).catch(() => { setWriteFailed(true); });
  }, [userId, date, validated, bonusFiredAt, sound]);

  if (!view) return <p>{'Un instant\u2026'}</p>;

  /**
   * Every write this screen makes goes through here. Two of them used to be
   * `async` functions handed to a prop typed `() => void`, so their rejections
   * were not merely unreported - they floated as unhandled promise
   * rejections. The others were fired off with a bare `void`, which says "I
   * know this is a promise" and then drops its failure just as completely.
   */
  const report = (write: Promise<unknown>) => {
    void write.catch(() => { setWriteFailed(true); });
  };

  const toggle = (id: TickableItemId, next: boolean) => {
    playTick(sound);
    // Keyed off the date, never off view.log.id, which is the empty string on a
    // day with no stored row yet. And flipped from the STORED tick rather than
    // written as `next`, which the browser derived from the rendered box: two
    // fast taps both read the same rendered state, so both wrote `true` and
    // the untick was lost. `next` is still the seed for the first tap, when no
    // tick is stored and the box may be showing something else as satisfied -
    // a logged run standing in for an unticked `course`.
    report(updateDayLog(userId, view.date, (row) => ({
      ticks: { [id]: row.ticks[id] === undefined ? next : !row.ticks[id] },
    })));
  };

  const useJoker = () => {
    // One repo call, so the day log and the week plan move in one transaction:
    // the invariant is one joker per ISO week, and it lives across both rows.
    report(spendJoker(userId, view.date));
  };

  // The draft while she is typing into the field, the stored count otherwise.
  const stepsText = stepsDraft !== null && stepsDraft.date === view.date
    ? stepsDraft.text
    : String(view.log.steps ?? '');

  const setSteps = (raw: string) => {
    const entry = readCount(raw);
    // Rejected, so neither stored nor shown: the field keeps what it had,
    // which is what makes a typed "abc" leave it empty rather than showing
    // text that would read back as NaN.
    if (entry.kind === 'reject') return;
    setStepsDraft({ date: view.date, text: raw });
    // An absolute value, not a value computed from the stored one, so a plain
    // patch is right here: the draft above is what the digits accumulate in.
    report(updateDayLog(userId, view.date, {
      steps: entry.kind === 'clear' ? null : entry.value,
    }));
  };

  return (
    <div className="today">
      <Confetti active={celebrating} />

      <StreakCard
        streak={view.streak}
        daysLeft={view.daysLeft}
        cycleComplete={view.cycleComplete}
        jokerAvailable={view.jokerAvailable}
        onUseJoker={useJoker}
      />

      <Card laced>
        <h1 className="today__date">{longDate(view.date)}</h1>

        {/* Above the checklist and inside the same card, so it is the first
            thing under the date and needs no scrolling to be seen - a notice
            about a tick that did not take is worth nothing below the fold.
            role="alert" is what makes a screen reader say it at all, the way
            Onboarding's validation error does. */}
        {writeFailed && (
          <div className="today__oops" role="alert">
            <p className="today__oopstitle">{WRITE_FAILED.title}</p>
            <p className="today__oopsline">{WRITE_FAILED.line}</p>
            <Button variant="quiet" onClick={() => setWriteFailed(false)}>
              {WRITE_FAILED.dismiss}
            </Button>
          </div>
        )}

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
            value={stepsText}
            onChange={(event) => setSteps(event.target.value)}
            // Back to the stored count once she is done with the field: every
            // keystroke has already been written, so this only re-syncs the
            // text - it is not what commits the count, which a blur a
            // backgrounded PWA never sends would then lose.
            onBlur={() => setStepsDraft(null)}
          />
        </div>

        <div className="today__amount">
          <span className="today__amountrow">
            {/* A <label htmlFor>, matching the steps row above: as a plain
                <span> the count beside it had no name at all, and a screen
                reader read out a bare number. */}
            <label className="today__amountname" htmlFor="today-water">Eau</label>
            <span className="today__amounthint">
              {`\u00b7 objectif ${grouped(view.settings.waterTarget)}`}
            </span>
          </span>
          <Stepper
            id="today-water"
            label="Eau"
            value={view.log.waterGlasses ?? WATER_MIN}
            min={WATER_MIN}
            max={WATER_MAX}
            step={1}
            onChange={(next) => {
              playTick(sound);
              // The tap as a MOVE applied to the stored count, not as the
              // absolute `next` the stepper computed from the rendered one.
              // Three fast taps all render the same count, so three absolute
              // writes stored 1 and lost two glasses; three moves store 3.
              // Clamped in here as well, because the stepper's own min/max
              // only guard the value it was rendered with.
              const move = next - (view.log.waterGlasses ?? WATER_MIN);
              report(updateDayLog(userId, view.date, (row) => ({
                waterGlasses: Math.min(
                  WATER_MAX,
                  Math.max(WATER_MIN, (row.waterGlasses ?? WATER_MIN) + move),
                ),
              })));
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
