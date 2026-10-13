import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bow } from '@/ui/Bow';
import '@/ui/BowCheckbox.css';

export interface BowCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function BowCheckbox({ label, checked, onChange, disabled = false }: BowCheckboxProps) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      className={`bowbox${checked ? ' bowbox--on' : ''}`}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span className="bowbox__mark">
        <AnimatePresence initial={false}>
          {checked && (
            <motion.span
              key="bow"
              initial={reduced ? { opacity: 0 } : { scale: 0.3, rotate: -18, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              transition={reduced ? { duration: 0.01 } : { type: 'spring', stiffness: 520, damping: 17 }}
              style={{ display: 'grid' }}
            >
              <Bow className="bowbox__bow" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="bowbox__label">{label}</span>
    </button>
  );
}
