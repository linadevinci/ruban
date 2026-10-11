import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from '@/ui/Stepper';

describe('Stepper', () => {
  it('increments and decrements by the step', async () => {
    const onChange = vi.fn();
    render(<Stepper label="Eau" value={3} min={0} max={10} step={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps at both bounds', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="Eau" value={10} min={0} max={10} step={1} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Stepper label="Eau" value={0} min={0} max={10} step={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the current value', () => {
    render(<Stepper label="Eau" value={3} min={0} max={10} step={1} onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
