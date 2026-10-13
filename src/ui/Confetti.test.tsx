import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Confetti } from '@/ui/Confetti';

describe('Confetti with motion allowed', () => {
  it('renders nothing while inactive', () => {
    const { container } = render(<Confetti active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('showers bows when active', () => {
    render(<Confetti active />);
    expect(screen.getByTestId('confetti-shower')).toBeInTheDocument();
    expect(screen.getAllByTestId('bow')).toHaveLength(18);
  });

  it('does not fall back to the reduced-motion pulse', () => {
    render(<Confetti active />);
    expect(screen.queryByTestId('confetti-pulse')).not.toBeInTheDocument();
  });
});
