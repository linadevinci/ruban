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
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
