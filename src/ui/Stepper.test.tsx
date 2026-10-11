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

  it('stays enabled one step short of each bound, and reaches it exactly', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="Eau" value={9} min={0} max={10} step={1} onChange={onChange} />,
    );
    // A `>=` slip in the increment guard would wrongly disable this at max - step.
    await userEvent.click(screen.getByRole('button', { name: 'Augmenter Eau' }));
    expect(onChange).toHaveBeenCalledWith(10);

    onChange.mockClear();
    rerender(<Stepper label="Eau" value={1} min={0} max={10} step={1} onChange={onChange} />);
    // A `<=` slip in the decrement guard would wrongly disable this at min + step.
    await userEvent.click(screen.getByRole('button', { name: 'Diminuer Eau' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('shows the current value, and updates when it changes', () => {
    // Two distinct values, neither equal to min, max or step. A single
    // assertion at value={3} passes against a hardcoded 3, and against a
    // render of step, which is also 1 away. Re-rendering is what makes this
    // discriminate.
    const { rerender } = render(
      <Stepper label="Eau" value={7} min={0} max={10} step={1} onChange={() => {}} />,
    );
    expect(screen.getByText('7')).toBeInTheDocument();

    rerender(<Stepper label="Eau" value={2} min={0} max={10} step={1} onChange={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });
});
