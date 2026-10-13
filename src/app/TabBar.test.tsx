import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { TabBar } from '@/app/TabBar';

describe('TabBar', () => {
  it('signals the active tab by something other than its colour', () => {
    render(<MemoryRouter initialEntries={['/poids']}><TabBar /></MemoryRouter>);

    const active = screen.getByRole('link', { name: 'Poids' });
    const inactive = screen.getByRole('link', { name: 'Calories' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(inactive).not.toHaveAttribute('aria-current');

    // The second channel. Everything that told the two states apart used to
    // live in one `color` declaration, and spec 10 measures cerise at 5.69:1
    // and ink-soft at 5.64:1 on this surface - the same luminance to within
    // 0.05, so the active tab was indistinguishable in greyscale and to most
    // colour-vision deficiencies. Asserted on the mark element rather than on
    // a class or a computed colour, because an element is the one thing here
    // that cannot be a colour.
    expect(active.querySelectorAll('.tabbar__mark')).toHaveLength(1);
    expect(inactive.querySelectorAll('.tabbar__mark')).toHaveLength(0);

    // And the label survived being wrapped in a render prop.
    expect(active).toHaveTextContent('Poids');
  });

  it('marks exactly one tab, and the right one', () => {
    // Probed rather than assumed: under react-router 8 a NavLink to='/' does
    // not match '/poids' as a prefix, so `end` is not what keeps this to one
    // mark here - the mark being rendered for the active tab only is. What
    // this pins is that one tab and only one carries it on either route.
    const { unmount } = render(
      <MemoryRouter initialEntries={['/poids']}><TabBar /></MemoryRouter>,
    );
    expect(screen.getByRole('navigation').querySelectorAll('.tabbar__mark')).toHaveLength(1);
    unmount();

    render(<MemoryRouter initialEntries={['/']}><TabBar /></MemoryRouter>);
    const nav = screen.getByRole('navigation');
    expect(nav.querySelectorAll('.tabbar__mark')).toHaveLength(1);
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('hui');
  });
});
