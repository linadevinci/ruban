import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Pill } from '@/ui/Pill';

export function StreakCard({
  streak, daysLeft, cycleComplete, jokerAvailable, onUseJoker,
}: {
  streak: number;
  daysLeft: number;
  /** True from goalDate + 1, when there is nothing left to count down to. */
  cycleComplete: boolean;
  jokerAvailable: boolean;
  onUseJoker: () => void;
}) {
  return (
    <>
      <div className="today__head">
        <div className="today__streak" data-testid="streak">
          <span className="today__streaknum">{streak}</span>
          <span className="label">{plural(streak, 'jour', 'jours')} d'affilée</span>
        </div>
        <span data-testid="countdown">
          {/* Past the goal date daysUntil goes negative, and the minus in
              front of it made the pill read "J--1" - a countdown counting up,
              in the wrong direction, with two minus signs. Spec 4.9 gives the
              cycle summary and the new goal to Plan 3; until then the pill
              says the cycle is over rather than rendering a negative day. */}
          <Pill>{cycleComplete ? 'Cycle terminé' : `J\u2212${daysLeft}`}</Pill>
        </span>
      </div>
      {jokerAvailable && (
        <div>
          <p className="today__joker">
            {/* No-break space before the question mark, French typography. */}
            Un imprévu{'\u00a0'}? Il te reste ton joker de la semaine.
          </p>
          <Button variant="quiet" onClick={onUseJoker}>Utiliser mon joker</Button>
        </div>
      )}
    </>
  );
}
