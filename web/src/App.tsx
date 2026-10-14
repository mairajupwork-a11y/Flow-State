import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './lib/queries';
import { PageLoader } from './components/ui';
import { AuthPage } from './features/auth/AuthPage';
import { Welcome } from './features/auth/Welcome';
import { AcceptInvite } from './features/auth/AcceptInvite';
import { Onboarding } from './features/onboarding/Onboarding';
import { AppShell } from './layout/AppShell';
import { Overview } from './features/home/Overview';
import { ProjectLayout } from './features/project/ProjectLayout';
import { Board } from './features/project/Board';
import { Backlog } from './features/project/Backlog';
import { ListView } from './features/project/ListView';
import { MyTasks } from './features/personal/MyTasks';
import { MyDay } from './features/personal/MyDay';
import { NotFound } from './features/home/NotFound';

// Heavier, less-visited screens load on demand.
const Timeline = lazy(() => import('./features/project/Timeline'));
const CalendarView = lazy(() => import('./features/project/CalendarView'));
const Reports = lazy(() => import('./features/project/Reports'));
const ProjectSettings = lazy(() => import('./features/project/ProjectSettings'));
const Team = lazy(() => import('./features/team/Team'));
const Settings = lazy(() => import('./features/settings/Settings'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSession();
  const location = useLocation();
  if (isLoading) return <div className="boot"><PageLoader /></div>;
  if (!data?.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function Home() {
  const { data, isLoading } = useSession();
  if (isLoading) return <div className="boot"><PageLoader /></div>;
  if (!data?.user) return <Navigate to="/welcome" replace />;
  if (!data.workspaces.length) return <Navigate to="/onboarding" replace />;
  let last: string | null = null;
  try {
    last = localStorage.getItem('fs_last_ws');
  } catch {
    /* storage blocked */
  }
  const ws = data.workspaces.find((w) => w.slug === last) ?? data.workspaces[0];
  return <Navigate to={`/w/${ws.slug}`} replace />;
}

const lazyEl = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/w/:slug" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="p/:key" element={<ProjectLayout />}>
          <Route index element={<Navigate to="board" replace />} />
          <Route path="board" element={<Board />} />
          <Route path="backlog" element={<Backlog />} />
          <Route path="list" element={<ListView />} />
          <Route path="timeline" element={lazyEl(<Timeline />)} />
          <Route path="calendar" element={lazyEl(<CalendarView />)} />
          <Route path="reports" element={lazyEl(<Reports />)} />
          <Route path="settings" element={lazyEl(<ProjectSettings />)} />
        </Route>
        <Route path="my-tasks" element={<MyTasks />} />
        <Route path="my-day" element={<MyDay />} />
        <Route path="team" element={lazyEl(<Team />)} />
        <Route path="settings" element={lazyEl(<Settings />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound standalone />} />
    </Routes>
  );
}
