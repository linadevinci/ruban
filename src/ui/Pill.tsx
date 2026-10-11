import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Pill({ children, tone = 'rose' }: { children: ReactNode; tone?: 'rose' | 'quiet' }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}
