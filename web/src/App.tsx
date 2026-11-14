import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { queryClient, keys, useSession } from './lib/queries';
import { PageLoader } from './components/ui';
import { AuthPage } from './features/auth/AuthPage';
import { Welcome } from './features/auth/Welcome';
import { AcceptInvite } from './features/auth/AcceptInvite';
import { ForgotPassword, ResetPassword } from './features/auth/PasswordReset';
import { Onboarding } from './features/onboarding/Onboarding';
import { AppShell } from './layout/AppShell';
import { Overview } from './features/home/Overview';
import { ProjectLayout, ProjectIndex, RequireView } from './features/project/ProjectLayout';
import { Board } from './features/project/Board';
import { Backlog } from './features/project/Backlog';
import { ListView } from './features/project/ListView';
import { MyTasks } from './features/personal/MyTasks';
import { MyDay } from './features/personal/MyDay';
const Timesheets = lazy(() => import('./features/personal/Timesheets'));
const Integrations = lazy(() => import('./features/settings/Integrations'));
const Workload = lazy(() => import('./features/team/Workload'));
import { SharedProject } from './features/auth/SharedProject';
import { NotFound } from './features/home/NotFound';

// Heavier, less-visited screens load on demand.
const Timeline = lazy(() => import('./features/project/Timeline'));
const CalendarView = lazy(() => import('./features/project/CalendarView'));
const Reports = lazy(() => import('./features/project/Reports'));
const ProjectSettings = lazy(() => import('./features/project/ProjectSettings'));
const Phases = lazy(() => import('./features/project/Phases'));
const Registers = lazy(() => import('./features/project/Registers'));
const Charter = lazy(() => import('./features/project/Charter'));
const Team = lazy(() => import('./features/team/Team'));
const Settings = lazy(() => import('./features/settings/Settings'));

/** Shown when the app opened (for example from the home screen) but the server can't be reached. */
function Offline() {
  useEffect(() => {
    const retry = () => void queryClient.invalidateQueries({ queryKey: keys.session });
    addEventListener('online', retry);
    return () => removeEventListener('online', retry);
  }, []);
  return (
    <div className="boot offline-screen" role="alert">
      <img src="/icon-192.png" alt="" width={64} height={64} />
      <h1>{navigator.onLine ? 'Can’t reach WorkMars' : 'You’re offline'}</h1>
      <p>{navigator.onLine ? 'The server isn’t answering right now.' : 'Reconnect and we’ll pick up where you left off.'}</p>
      <button className="btn btn-primary" onClick={() => void queryClient.invalidateQueries({ queryKey: keys.session })}>Try again</button>
    </div>
  );
}
const unreachable = (data: unknown, error: unknown) => { const st = (error as { status?: number } | null)?.status; return !data && !!error && (!st || st >= 500); };

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useSession();
  const location = useLocation();
  if (isLoading) return <div className="boot"><PageLoader /></div>;
  if (unreachable(data, error)) return <Offline />;
  if (!data?.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function Home() {
  const { data, isLoading, error } = useSession();
  if (isLoading) return <div className="boot"><PageLoader /></div>;
  if (unreachable(data, error)) return <Offline />;
  if (!data?.user) return <Navigate to="/welcome" replace />;
  if (!data.workspaces.length) return <Navigate to="/onboarding" replace />;
  let last: string | null = null;
  try {
    last = localStorage.getItem('fs_last_ws');
  } catch {
    /* storage blocked */
  }
  const ws = data.workspaces.find((w) => w.slug === last) ?? data.workspaces[0];
  // PWA shortcuts open /?go=my-day etc.
  const go = new URLSearchParams(window.location.search).get('go');
  const page = go && ['my-day', 'my-tasks', 'team', 'settings'].includes(go) ? `/${go}` : '';
  return <Navigate to={`/w/${ws.slug}${page}`} replace />;
}

const lazyEl = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/share/:token" element={<SharedProject />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/w/:slug" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="p/:key" element={<ProjectLayout />}>
          <Route index element={<ProjectIndex />} />
          <Route path="board" element={<Board />} />
          <Route path="backlog" element={<RequireView view="backlog"><Backlog /></RequireView>} />
          <Route path="phases" element={<RequireView view="phases">{lazyEl(<Phases />)}</RequireView>} />
          <Route path="registers" element={<RequireView view="registers">{lazyEl(<Registers />)}</RequireView>} />
          <Route path="charter" element={<RequireView view="charter">{lazyEl(<Charter />)}</RequireView>} />
          <Route path="list" element={<ListView />} />
          <Route path="timeline" element={lazyEl(<Timeline />)} />
          <Route path="calendar" element={lazyEl(<CalendarView />)} />
          <Route path="reports" element={lazyEl(<Reports />)} />
          <Route path="settings" element={lazyEl(<ProjectSettings />)} />
        </Route>
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="my-day" element={<MyDay />} />
        <Route path="timesheets" element={lazyEl(<Timesheets />)} />
        <Route path="integrations" element={lazyEl(<Integrations />)} />
        <Route path="workload" element={lazyEl(<Workload />)} />
        <Route path="team" element={lazyEl(<Team />)} />
        <Route path="settings" element={lazyEl(<Settings />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound standalone />} />
    </Routes>
  );
}
