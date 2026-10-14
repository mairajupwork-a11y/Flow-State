import { NavLink } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useWs, useCurrentProject } from '../lib/workspace';

export function MobileNav({ activeKey }: { activeKey?: string }) {
  const { base } = useWs();
  const project = useCurrentProject(activeKey);
  const items: [string, string, string, boolean?][] = [
    [base, 'grid', 'Home', true],
    [project ? `${base}/p/${project.key}/board` : base, 'board', 'Board'],
    [`${base}/my-tasks`, 'checkcircle', 'My tasks'],
    [`${base}/my-day`, 'sun', 'My day'],
    [`${base}/team`, 'people', 'Team'],
  ];
  return (
    <nav className="mobile-bottom" aria-label="Mobile navigation">
      {items.map(([to, icon, label, end]) => (
        <NavLink key={label} to={to} end={end} className={({ isActive }) => `mobile-nav-btn ${isActive ? 'active' : ''}`}>
          <Icon name={icon} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
