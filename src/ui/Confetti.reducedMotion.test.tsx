import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Confetti } from '@/ui/Confetti';

// framer-motion reads prefers-reduced-motion once and caches it behind a
// module-level guard, so the stub has to be in place before the first render.
// Vitest gives each file its own module registry, which is why this lives in
// its own file rather than alongside the ordinary-path tests.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {},
  dispatchEvent: () => false,
}));

describe('Confetti under prefers-reduced-motion', () => {
  it('renders nothing while inactive', () => {
    const { container } = render(<Confetti active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gives one soft pulse instead of the shower', () => {
    render(<Confetti active />);
    expect(screen.getByTestId('confetti-pulse')).toBeInTheDocument();
    expect(screen.queryByTestId('confetti-shower')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('bow')).toHaveLength(0);
  });
});
