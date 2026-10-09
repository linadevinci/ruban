import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BowCheckbox } from '@/ui/BowCheckbox';

describe('BowCheckbox', () => {
  it('exposes a real checkbox to assistive technology', () => {
    render(<BowCheckbox label="Course" checked={false} onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Course' });
    expect(box).not.toBeChecked();
  });

  it('reports the next value on click', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports false when unticking', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('shows the bow only when checked', () => {
    const { rerender } = render(<BowCheckbox label="Course" checked={false} onChange={() => {}} />);
    expect(screen.queryByTestId('bow')).not.toBeInTheDocument();
    rerender(<BowCheckbox label="Course" checked onChange={() => {}} />);
    expect(screen.getByTestId('bow')).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} disabled />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Course' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is operable from the keyboard', async () => {
    const onChange = vi.fn();
    render(<BowCheckbox label="Course" checked={false} onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
