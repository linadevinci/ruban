import type { ChecklistItem } from '@/domain/checklist';
import type { ChecklistItemId, TickableItemId } from '@/domain/types';
import { BowCheckbox } from '@/ui/BowCheckbox';

/**
 * Spec 4.2's five items, named for the screen. Not exported: a non-primitive
 * export beside a component trips oxlint's only-export-components rule, which
 * allowConstantExport only waives for primitives, and nothing outside this
 * file needs the map.
 */
const LABELS: Record<ChecklistItemId, string> = {
  course: 'Course',
  calories: 'Calories respectées',
  no_dinner: 'Pas de dîner',
  steps: 'Pas',
  water: 'Eau',
};

/**
 * The three items a tap can satisfy. `steps` and `water` are derived from the
 * amounts logged under the list, so a box for either would be a second,
 * disagreeing source of truth.
 */
const TICKABLE: TickableItemId[] = ['course', 'calories', 'no_dinner'];

function isTickable(id: ChecklistItemId): id is TickableItemId {
  return (TICKABLE as ChecklistItemId[]).includes(id);
}

export function Checklist({
  items, onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (id: TickableItemId, next: boolean) => void;
}) {
  return (
    <div className="today__items">
      {items.map((item) => {
        // Narrowed through a const, so the closure below keeps the narrowing
        // and no cast is needed to call onToggle.
        const id = item.id;
        if (!isTickable(id)) return null;
        return (
          <BowCheckbox
            key={id}
            label={LABELS[id]}
            checked={item.satisfied}
            onChange={(next) => onToggle(id, next)}
          />
        );
      })}
    </div>
  );
}
