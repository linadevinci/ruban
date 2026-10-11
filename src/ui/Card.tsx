import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Card({ laced = false, children }: { laced?: boolean; children: ReactNode }) {
  return (
    <section className="card">
      {laced && <div className="lace" />}
      <div className="card__body">{children}</div>
    </section>
  );
}
