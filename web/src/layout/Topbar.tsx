import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Avatar, Kbd } from '../components/ui';
import { useWs } from '../lib/workspace';
import { keys, useNotifications } from '../lib/queries';
import { ui } from '../lib/store';
import { api } from '../lib/api';
import { useTheme } from '../lib/theme';
import { timeAgo } from '../lib/format';
import { useOutsideClose } from './Sidebar';
import { methodologyOf, viewMeta } from '../lib/methodology';

const VIEW_LABEL: Record<string, string> = {
  board: 'Board', backlog: 'Backlog', list: 'List', timeline: 'Timeline', calendar: 'Calendar', reports: 'Reports', settings: 'Settings',
  phases: 'Phases', registers: 'Registers', charter: 'Charter', 'my-tasks': 'My tasks', 'my-day': 'My day', team: 'Team',
};

export function Topbar({ activeKey }: { activeKey?: string }) {
  const { workspace, projects, me, base } = useWs();
  const location = useLocation();
  const [, setTheme, dark] = useTheme();
  const project = projects.find((p) => p.key === activeKey);
  const last = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const view = project && VIEW_LABEL[last] && !['my-tasks', 'my-day', 'team'].includes(last) ? viewMeta(methodologyOf(project), last).label : VIEW_LABEL[last];
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="topbar">
      <div className="row-12" style={{ minWidth: 0 }}>
        <button className="icon-btn mobile-menu" onClick={() => ui.set({ sidebarOpen: true })} aria-label="Open menu" aria-controls="sidebar"><Icon name="menu" size={20} /></button>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link to={base} className="hide-mobile crumb">{workspace.name}</Link>
          <span className="hide-mobile"><Icon name="right" size={13} /></span>
          {project && <Link to={`${base}/p/${project.key}`} className={view ? 'crumb hide-mobile' : 'current crumb'}>{project.name}</Link>}
          {project && view && <span className="hide-mobile"><Icon name="right" size={13} /></span>}
          {view ? <span className="current">{view}</span> : !project && <span className="current">Overview</span>}
        </nav>
      </div>
      <div className="top-right">
        <button className="search-box" onClick={() => ui.set({ paletteOpen: true })} aria-label="Search and commands">
          <Icon name="search" size={16} />
          <span className="search-placeholder">Search or jump to…</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </button>
        <button className="icon-btn search-mobile" onClick={() => ui.set({ paletteOpen: true })} aria-label="Search"><Icon name="search" /></button>
        <span className="divider-v" />
        <Notifications />
        <button className="icon-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Switch to light theme' : 'Switch to dark theme'} aria-label="Toggle light or dark theme">
          <Icon name={dark ? 'sun' : 'moon'} size={19} />
        </button>
        <span className="divider-v" />
        <Link to={`${base}/my-day`} className="profile-head" title="My day" aria-label="Open My day"><Avatar user={me} size="lg" /></Link>
      </div>
    </header>
  );
}

function Notifications() {
  const { workspace, locale } = useWs();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications(workspace.slug);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  const unread = data?.unread ?? 0;

  async function markAll() {
    await api.post(`/notifications/${workspace.slug}/read`, {});
    qc.invalidateQueries({ queryKey: keys.notifications(workspace.slug) });
  }
  function openItem(id: number, issueKey: string | null) {
    api.post(`/notifications/${workspace.slug}/read`, { ids: [id] }).then(() => qc.invalidateQueries({ queryKey: keys.notifications(workspace.slug) }));
    setOpen(false);
    if (issueKey) navigate(`${location.pathname}?issue=${issueKey}`);
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Icon name="bell" />
        {unread > 0 && <span className="notif-dot" />}
      </button>
      {open && (
        <div className="dropdown notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="row-between"><h4>Notifications</h4>{unread > 0 && <button className="link-btn" onClick={markAll}>Mark all as read</button>}</div>
          <div className="notif-list">
            {data?.items.length ? data.items.map((n) => (
              <button key={n.id} className={`notification ${n.read ? '' : 'unread'}`} onClick={() => openItem(n.id, n.issueKey)}>
                {n.actor ? <Avatar user={n.actor} size="sm" /> : <span className="avatar sm" style={{ background: 'var(--accent)' }}><Icon name="bell" size={11} /></span>}
                <span><span className="notif-text">{n.text}</span><small>{timeAgo(n.createdAt, locale)}</small></span>
              </button>
            )) : (
              <div className="empty" style={{ padding: '26px 8px' }}><Icon name="bell" size={30} /><p>You’re all caught up.<br />We’ll let you know when something needs you.</p></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
