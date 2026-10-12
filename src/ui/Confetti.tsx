import { motion, useReducedMotion } from 'framer-motion';
import { Bow } from '@/ui/Bow';

const PIECES = 18;

/** A one-shot shower of bows. Reduced motion gets a single soft pulse instead. */
export function Confetti({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  if (!active) return null;

  if (reduced) {
    return (
      <motion.div
        data-testid="confetti-pulse"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'var(--rose)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.22, 0] }}
        transition={{ duration: 0.9 }}
      />
    );
  }

  return (
    <div
      data-testid="confetti-shower"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {Array.from({ length: PIECES }, (_, i) => (
        <motion.div
          key={i}
          style={{ position: 'absolute', top: -30, left: `${(i / PIECES) * 100}%`, width: 20, height: 20 }}
          initial={{ y: -40, opacity: 0, rotate: 0 }}
          animate={{ y: '100vh', opacity: [0, 1, 1, 0], rotate: 320 }}
          transition={{ duration: 2.1 + (i % 5) * 0.22, delay: (i % 7) * 0.08, ease: 'easeIn' }}
        >
          <Bow className="bowbox__bow" />
        </motion.div>
      ))}
    </div>
  );
}
