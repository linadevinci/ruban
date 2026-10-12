import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Pill } from '@/ui/Pill';

export function StreakCard({
  streak, daysLeft, jokerAvailable, onUseJoker,
}: {
  streak: number;
  daysLeft: number;
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
          <Pill>{`J\u2212${daysLeft}`}</Pill>
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
