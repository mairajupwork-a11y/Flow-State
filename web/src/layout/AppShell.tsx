import { useEffect, useMemo } from 'react';
import { Outlet, useMatch, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSession, useWorkspace } from '../lib/queries';
import { WorkspaceProvider, useRealtime } from '../lib/workspace';
import { ui, useUi, openCreate, openGuide } from '../lib/store';
import { ErrorState, PageLoader } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { CommandPalette } from './CommandPalette';
import { ShortcutsHelp } from './ShortcutsHelp';
import { IssueModal } from '../features/issue/IssueModal';
import { CreateIssueModal } from '../features/issue/CreateIssueModal';
import { GuideDrawer } from '../features/ai/GuideDrawer';
import { CreateProjectModal } from '../features/project/CreateProjectModal';
import { InviteModal } from '../features/team/InviteModal';

const lastProjectKey = (slug: string) => `fs_last_project_${slug}`;

export function AppShell() {
  const { slug = '' } = useParams();
  const session = useSession();
  const ws = useWorkspace(slug);
  const navigate = useNavigate();
  useRealtime(slug);

  useEffect(() => {
    try {
      localStorage.setItem('fs_last_ws', slug);
    } catch {
      /* storage blocked */
    }
  }, [slug]);

  const value = useMemo(
    () => (ws.data && session.data?.user ? { workspace: ws.data.workspace, me: session.data.user, members: ws.data.members, projects: ws.data.projects } : null),
    [ws.data, session.data],
  );

  if (ws.error) {
    return (
      <div className="center-screen">
        <div style={{ maxWidth: 480, width: '100%' }}>
          <ErrorState error={ws.error} retry={() => navigate('/')} />
        </div>
      </div>
    );
  }
  if (!value) return <div className="boot"><PageLoader /></div>;

  return (
    <WorkspaceProvider value={value}>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const { slug = '' } = useParams();
  const projectMatch = useMatch('/w/:slug/p/:key/*');
  const routeKey = projectMatch?.params.key;
  const [params, setParams] = useSearchParams();
  const issueRef = params.get('issue');
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const navigate = useNavigate();

  useEffect(() => {
    if (routeKey) {
      try {
        localStorage.setItem(lastProjectKey(slug), routeKey);
      } catch {
        /* storage blocked */
      }
    }
  }, [routeKey, slug]);

  useShortcuts(slug, routeKey, navigate);

  const closeIssue = () => {
    const next = new URLSearchParams(params);
    next.delete('issue');
    setParams(next, { replace: true });
  };

  return (
    <div className="app-shell">
      <div className={`sidebar-shade ${sidebarOpen ? 'visible' : ''}`} onClick={() => ui.set({ sidebarOpen: false })} />
      <Sidebar activeKey={routeKey} />
      <div className="main-shell">
        <Topbar activeKey={routeKey} />
        <main id="page" className="page">
          <Outlet />
        </main>
      </div>
      <MobileNav activeKey={routeKey} />
      <button className="floating-ai" onClick={() => openGuide()} title="Ask the Flow guide (free)" aria-label="Open the Flow guide">
        <Icon name="sparkles" size={23} />
      </button>

      {issueRef && <IssueModal issueRef={issueRef} onClose={closeIssue} />}
      <GlobalModals routeKey={routeKey} />
    </div>
  );
}

function GlobalModals({ routeKey }: { routeKey?: string }) {
  const create = useUi((s) => s.create);
  const guideOpen = useUi((s) => s.guideOpen);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const shortcutsOpen = useUi((s) => s.shortcutsOpen);
  const createProjectOpen = useUi((s) => s.createProjectOpen);
  const inviteOpen = useUi((s) => s.inviteOpen);
  return (
    <>
      {create && <CreateIssueModal draft={create} routeKey={routeKey} onClose={() => ui.set({ create: null })} />}
      {guideOpen && <GuideDrawer routeKey={routeKey} onClose={() => ui.set({ guideOpen: false, guidePrompt: null })} />}
      {paletteOpen && <CommandPalette routeKey={routeKey} onClose={() => ui.set({ paletteOpen: false })} />}
      {shortcutsOpen && <ShortcutsHelp onClose={() => ui.set({ shortcutsOpen: false })} />}
      {createProjectOpen && <CreateProjectModal onClose={() => ui.set({ createProjectOpen: false })} />}
      {inviteOpen && <InviteModal onClose={() => ui.set({ inviteOpen: false })} />}
    </>
  );
}

/** Global keyboard shortcuts. Ignored while typing or when a dialog is open. */
function useShortcuts(slug: string, routeKey: string | undefined, navigate: (to: string) => void) {
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.set({ paletteOpen: !ui.get().paletteOpen });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.body.classList.contains('modal-open') || ui.get().guideOpen || ui.get().paletteOpen) return;
      let projectKey = routeKey;
      try {
        projectKey ??= localStorage.getItem(lastProjectKey(slug)) ?? undefined;
      } catch {
        /* storage blocked */
      }
      const base = `/w/${slug}`;
      if (Date.now() - pendingG < 900) {
        pendingG = 0;
        const map: Record<string, string> = { h: base, t: `${base}/my-tasks`, d: `${base}/my-day`, m: `${base}/team`, s: `${base}/settings` };
        if (projectKey) Object.assign(map, { b: `${base}/p/${projectKey}/board`, l: `${base}/p/${projectKey}/backlog`, r: `${base}/p/${projectKey}/reports`, i: `${base}/p/${projectKey}/list` });
        if (map[e.key]) {
          e.preventDefault();
          navigate(map[e.key]);
        }
        return;
      }
      if (e.key === 'g') pendingG = Date.now();
      else if (e.key === 'c') { e.preventDefault(); openCreate(); }
      else if (e.key === '/') { e.preventDefault(); ui.set({ paletteOpen: true }); }
      else if (e.key === '?') { e.preventDefault(); ui.set({ shortcutsOpen: true }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [slug, routeKey, navigate]);
}

export { lastProjectKey };
