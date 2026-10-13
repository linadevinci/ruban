import { NavLink } from 'react-router';
import '@/app/app.css';

const TABS = [
  { to: '/', label: 'Aujourd\u2019hui' },
  { to: '/poids', label: 'Poids' },
  { to: '/calories', label: 'Calories' },
  { to: '/course', label: 'Course' },
  { to: '/moi', label: 'Moi' },
];

export function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === '/'}>
          {/* The mark is the active tab's second channel, and the reason it is
              an element rather than a CSS pseudo-element: aria-current is the
              only thing in the DOM that told the two states apart, and
              everything else about them lived in one `color` declaration -
              which spec 10 says this palette cannot carry, cerise and
              ink-soft being within 0.05 of the same contrast ratio. Rendered
              only for the active tab, so a test can prove the difference is
              not a colour. aria-hidden because aria-current already says it. */}
          {({ isActive }) => (
            <>
              {tab.label}
              {isActive && <span className="tabbar__mark" aria-hidden="true" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
