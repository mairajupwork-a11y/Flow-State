import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { useWs, useCurrentProject } from '../lib/workspace';
import { useSession, useTodos } from '../lib/queries';
import { ui, useUi } from '../lib/store';
import { api } from '../lib/api';
import { todayISO } from '../lib/format';
import { methodologyOf, viewMeta } from '../lib/methodology';

function NavItem({ to, icon, label, end, counter }: { to: string; icon: string; label: string; end?: boolean; counter?: number }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => ui.set({ sidebarOpen: false })}>
      <Icon name={icon} />
      <span className="label">{label}</span>
      {counter ? <span className="side-counter">{counter}</span> : null}
    </NavLink>
  );
}

export function Sidebar({ activeKey }: { activeKey?: string }) {
  const { workspace, projects, me, base, canEdit } = useWs();
  const current = useCurrentProject(activeKey);
  const open = useUi((s) => s.sidebarOpen);
  const todos = useTodos(todayISO());
  const remaining = todos.data?.items.filter((t) => !t.done).length ?? 0;
  const p = current ? `${base}/p/${current.key}` : null;
  const navRef = useRef<HTMLElement>(null);

  // Move focus into the drawer on mobile so keyboard users land in it.
  useEffect(() => {
    if (open) navRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);

  return (
    <aside ref={navRef} id="sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Sidebar">
      <div className="brand">
        <span className="logo-mark"><Icon name="sparkles" size={24} /></span>
        <span className="brand-name">flowstate<span className="brand-dot">.</span></span>
      </div>
      <WorkspaceSwitcher />

      <div className="side-section-label">Workspace</div>
      <nav className="side-nav" aria-label="Primary navigation">
        <NavItem to={base} end icon="grid" label="Overview" />
        {p && methodologyOf(current).views.filter((v) => v !== 'settings' && v !== 'list').map((v) => {
          const meta = viewMeta(methodologyOf(current), v);
          return <NavItem key={v} to={`${p}/${v}`} icon={meta.icon} label={meta.label} />;
        })}
        <NavItem to={`${base}/my-tasks`} icon="checkcircle" label="My tasks" />
      </nav>

      <div className="side-section-label side-label-row">
        Projects
        {canEdit && (
          <button className="icon-btn tiny" title="Create project" aria-label="Create project" onClick={() => ui.set({ createProjectOpen: true, sidebarOpen: false })}>
            <Icon name="plus" size={15} />
          </button>
        )}
      </div>
      <div>
        {projects.map((proj) => (
          <NavLink key={proj.id} to={`${base}/p/${proj.key}`} className={() => `side-project ${current?.id === proj.id ? 'selected' : ''}`} onClick={() => ui.set({ sidebarOpen: false })}>
            <span className="project-glyph" style={{ background: proj.color }}>{proj.name[0]?.toUpperCase()}</span>
            <span className="ellipsis" style={{ flex: 1 }}>{proj.name}</span>
            {current?.id === proj.id && <Icon name="right" size={13} />}
          </NavLink>
        ))}
        {!projects.length && canEdit && (
          <button className="side-project" onClick={() => ui.set({ createProjectOpen: true })}><Icon name="plus" size={15} /> Create your first project</button>
        )}
      </div>

      <div className="side-section-label">Personal</div>
      <nav className="side-nav" aria-label="Personal navigation">
        <NavItem to={`${base}/my-day`} icon="sun" label="My day" counter={remaining} />
        <NavItem to={`${base}/team`} icon="people" label="Team" />
        <NavItem to={`${base}/settings`} icon="settings" label="Settings" />
      </nav>

      <div className="side-bottom">
        <div className="free-banner">
          <span className="mini-label">FREE. NO SEAT LIMITS.</span>
          <strong>Make room for everyone.</strong>
          <p>Invite your whole team — every feature is free for unlimited users.</p>
          {canEdit && <button className="btn btn-soft btn-sm" style={{ marginTop: 10, position: 'relative', zIndex: 1 }} onClick={() => ui.set({ inviteOpen: true, sidebarOpen: false })}><Icon name="plus" size={13} /> Invite people</button>}
        </div>
        <UserBox />
      </div>
      <span className="sr-only">{workspace.name}, signed in as {me.name}</span>
    </aside>
  );
}

function WorkspaceSwitcher() {
  const { workspace } = useWs();
  const { data } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="ws-switch-wrap" ref={ref}>
      <button className="workspace-switch" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="ws-avatar">{workspace.name[0]?.toUpperCase()}</span>
        <span className="ellipsis"><b className="ellipsis">{workspace.name}</b><small>Free workspace · {workspace.role}</small></span>
        <span className="chevron"><Icon name="chevron" size={15} /></span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">Your workspaces</div>
          {data?.workspaces.map((w) => (
            <button key={w.id} role="menuitem" className={`menu-item ${w.slug === workspace.slug ? 'current' : ''}`} onClick={() => { setOpen(false); navigate(`/w/${w.slug}`); }}>
              <span className="ws-avatar sm">{w.name[0]?.toUpperCase()}</span>
              <span className="ellipsis" style={{ flex: 1 }}>{w.name}</span>
              {w.slug === workspace.slug && <Icon name="check" size={14} />}
            </button>
          ))}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={() => navigate('/onboarding')}><Icon name="plus" size={15} /> Create a new workspace</button>
        </div>
      )}
    </div>
  );
}

function UserBox() {
  const { me, base } = useWs();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  async function signOut() {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/welcome', { replace: true });
  }
  return (
    <div className="user-box" ref={ref}>
      <Avatar user={me} size="lg" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="user-name ellipsis">{me.name}</div>
        <div className="user-role ellipsis">{me.jobTitle || me.email}</div>
      </div>
      <button className="icon-btn" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="ellipsis" /></button>
      {open && (
        <div className="menu menu-up" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate(`${base}/settings`); }}><Icon name="settings" size={15} /> Profile & settings</button>
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); ui.set({ shortcutsOpen: true }); }}><Icon name="keyboard" size={15} /> Keyboard shortcuts</button>
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item danger" onClick={signOut}><Icon name="logout" size={15} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

/** Closes a popover on outside click or Escape. */
export function useOutsideClose<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}
