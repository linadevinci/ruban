import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BowCheckbox } from '@/ui/BowCheckbox';

// framer-motion caches prefers-reduced-motion in module scope on first use, so
// the stub must be in place before this file's first render. Vitest gives each
// file its own module registry, which is why this lives in its own file.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  dispatchEvent: () => false,
}));

describe('BowCheckbox under prefers-reduced-motion', () => {
  it('still shows the bow when checked', () => {
    render(<BowCheckbox label="Course" checked onChange={() => {}} />);
    expect(screen.getByTestId('bow')).toBeInTheDocument();
  });
});
