import type { ReactNode } from 'react';
import '@/ui/primitives.css';

export function Button({
  children, onClick, variant = 'solid', disabled = false, type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'solid' | 'quiet';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`btn btn--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
