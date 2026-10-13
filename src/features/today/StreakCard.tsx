import type { IsoDate } from '@/domain/types';
import { Button } from '@/ui/Button';
import { longDate, plural } from '@/ui/format';
import { Pill } from '@/ui/Pill';

export function StreakCard({
  streak, daysLeft, cycleComplete, jokerAvailable,
  yesterday, yesterdayExcusable, onUseJoker, onExcuseYesterday,
}: {
  streak: number;
  daysLeft: number;
  /** True from goalDate + 1, when there is nothing left to count down to. */
  cycleComplete: boolean;
  jokerAvailable: boolean;
  /** The day the second button would excuse, named in its own label. */
  yesterday: IsoDate;
  yesterdayExcusable: boolean;
  onUseJoker: () => void;
  onExcuseYesterday: () => void;
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
      {(jokerAvailable || yesterdayExcusable) && (
        <div>
          {/* Held in reserve, not a verdict. The old line - "Un imprevu ? Il
              te reste ton joker" - showed on EVERY uncovered day, so at 08:00
              on a day she was going to finish the app had already decided she
              had failed. */}
          <p className="today__joker">
            Ton joker de la semaine est intact, au cas où.
          </p>
          {/* Each button names the day it spends the joker on. There is one
              joker per ISO week and spending it on the wrong day cannot be
              undone, so "Utiliser mon joker" beside an offer for yesterday
              would be the one ambiguity worth never having. */}
          <div className="today__jokeracts">
            {jokerAvailable && (
              <Button variant="quiet" onClick={onUseJoker}>
                {'Excuser aujourd\u2019hui'}
              </Button>
            )}
            {yesterdayExcusable && (
              <Button variant="quiet" onClick={onExcuseYesterday}>
                {`Excuser ${longDate(yesterday)}`}
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
