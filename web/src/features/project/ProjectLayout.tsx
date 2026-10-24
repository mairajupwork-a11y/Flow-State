import { sceneFor, sceneStyle } from '../../lib/scenes';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { useIssues, useProject } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { openCreate, openGuide } from '../../lib/store';
import { Icon } from '../../components/Icon';
import { AvatarGroup, ErrorState, PageHeader, PageLoader } from '../../components/ui';
import { PRIORITIES, PRIORITY_LABEL, todayISO, daysBetween, fmtDate } from '../../lib/format';
import { methodologyOf, typeLabel, viewMeta, gateWord, term } from '../../lib/methodology';
import type { Issue, IssueType, Priority, ProjectDetail } from '../../lib/types';
import { NotFound } from '../home/NotFound';

export interface Filters { q: string; assignee: string; priority: Priority | ''; type: IssueType | ''; label: string }
const EMPTY: Filters = { q: '', assignee: '', priority: '', type: '', label: '' };

export interface ProjectCtx { project: ProjectDetail; issues: Issue[]; filtered: Issue[]; filters: Filters; setFilters: (f: Filters) => void }
export const useProjectCtx = () => useOutletContext<ProjectCtx>();

const HEADERS: Record<string, [string, string, string]> = {
  board: ['Project / Board', 'Build what’s next.', 'A calm, clear space for your whole team to move work forward.'],
  backlog: ['Planning / Backlog', 'Make space for the right work.', 'Prioritise ideas, shape your sprint and keep the next move obvious.'],
  list: ['Project / List', 'Everything, in one clear list.', 'A structured view of priorities, owners and due dates.'],
  timeline: ['Planning / Timeline', 'See the road ahead.', 'Connect milestones to the work that moves them forward.'],
  calendar: ['Schedule / Calendar', 'Your time, thoughtfully organised.', 'See upcoming due dates and plan around what matters.'],
  reports: ['Insights / Reports', 'Progress worth seeing.', 'Understand work distribution and make confident decisions.'],
  settings: ['Project / Settings', 'Shape how this project works.', 'Methodology, workflow columns, details and housekeeping — all in one place.'],
  phases: ['Lifecycle / Phases', 'One phase at a time, signed off.', 'Work through each phase in order and pass its gate before the next begins.'],
  registers: ['Governance / Registers', 'Know your risks before they know you.', 'Keep the logs your methodology relies on — scored, owned and up to date.'],
  charter: ['Definition / Charter', 'Agree why, what and how much.', 'The project definition everyone signs up to, in one place.'],
};

/** Header copy tuned to each practice's vocabulary. */
const HEADER_OVERRIDES: Record<string, Record<string, [string, string, string]>> = {
  scrumban: { board: ['Hybrid / Flow board', 'Pull, don’t push.', 'Work flows through WIP limits; plan an iteration whenever Ready runs low.'], backlog: ['Planning / Backlog', 'Keep Ready topped up.', 'Order the backlog, then pull items into the next iteration or straight to Ready.'] },
  kanban: { board: ['Flow / Kanban board', 'Stop starting, start finishing.', 'Pull work only when a column has capacity. Urgent items take the expedite lane.'] },
  lean: { board: ['Value stream / Board', 'Build, measure, learn.', 'Validate value with small experiments and remove waste along the way.'], charter: ['Lean / Value', 'Start with what customers value.', 'Define the customer, the value and the stream of steps that deliver it.'], registers: ['Lean / Waste & kaizen', 'See waste. Remove it.', 'Log the eight wastes and the small improvements that eliminate them.'] },
  waterfall: { phases: ['Waterfall / Phases', 'Sequential, gated delivery.', 'Requirements through to maintenance — each phase signed off before the next.'], timeline: ['Waterfall / Gantt', 'The whole plan at a glance.', 'Phases, deliverables and milestones laid out across the calendar.'], charter: ['Waterfall / Project definition', 'Fix the scope, then deliver it.', 'Objective, scope, budget and acceptance criteria agreed up front.'] },
  sixsigma: { phases: ['Six Sigma / DMAIC', 'Define, Measure, Analyse, Improve, Control.', 'Prove each step with data and pass every tollgate.'], charter: ['Six Sigma / Charter', 'A problem worth solving, defined precisely.', 'Problem, goal, CTQ and specification limits — the basis for every tollgate.'], registers: ['Six Sigma / FMEA & lessons', 'Rank failure modes by risk.', 'Severity × occurrence × detection gives each failure mode its RPN.'] },
  prince2: { phases: ['PRINCE2 / Management stages', 'Manage by stages. Manage by exception.', 'The Project Board authorises each stage at its boundary, within agreed tolerances.'], charter: ['PRINCE2 / Business case & PID', 'Continued business justification.', 'Reasons, benefits, costs, tolerances and the Project Board in one place.'], registers: ['PRINCE2 / Registers & logs', 'Risks, issues, quality and lessons.', 'The four PRINCE2 logs, owned and reviewed at every stage boundary.'] },
};

export function ProjectLayout() {
  const { key = '' } = useParams();
  const { projects, me, canEdit } = useWs();
  const summary = projects.find((p) => p.key === key);
  const project = useProject(summary?.id);
  const issues = useIssues(summary?.id);
  const location = useLocation();
  const view = location.pathname.split('/').pop() ?? 'board';
  const [filtersByProject, setFiltersByProject] = useState<Record<number, Filters>>({});
  const filters = (summary && filtersByProject[summary.id]) || EMPTY;

  const filtered = useMemo(() => {
    const list = issues.data ?? [];
    const q = filters.q.trim().toLowerCase();
    return list.filter((i) =>
      (!q || i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q) || i.labels.some((l) => l.toLowerCase().includes(q))) &&
      (!filters.priority || i.priority === filters.priority) &&
      (!filters.type || i.type === filters.type) &&
      (!filters.label || i.labels.includes(filters.label)) &&
      (!filters.assignee || (filters.assignee === 'me' ? i.assigneeId === me.id : filters.assignee === 'none' ? !i.assigneeId : String(i.assigneeId) === filters.assignee)));
  }, [issues.data, filters, me.id]);

  if (!summary) return <NotFound />;
  if (project.error || issues.error) return <ErrorState error={project.error ?? issues.error} retry={() => { project.refetch(); issues.refetch(); }} />;
  if (!project.data || !issues.data) return <PageLoader />;

  const ctx: ProjectCtx = { project: project.data, issues: issues.data, filtered, filters, setFilters: (f) => setFiltersByProject((s) => ({ ...s, [summary.id]: f })) };
  const m = methodologyOf(project.data);
  const [eyebrow, title, subtitle] = HEADER_OVERRIDES[m.id]?.[view] ?? HEADERS[view] ?? HEADERS.board;

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={
        <>
          <button className="btn btn-light" onClick={() => openGuide()}><Icon name="sparkles" size={16} /><span className="btn-label-mobile">Ask Mars guide</span></button>
          {canEdit && <button className="btn btn-primary" onClick={() => openCreate()}><Icon name="plus" size={16} /> Create task</button>}
        </>
      } />
      {(view === 'board' || view === m.views[0]) && view !== 'phases' && <><ProjectHero project={project.data} issues={issues.data} /><Metrics issues={issues.data} /></>}
      <Outlet context={ctx} />
    </>
  );
}

export function ProjectHero({ project, issues }: { project: ProjectDetail; issues: Issue[] }) {
  const { members, locale } = useWs();
  const work = issues.filter((i) => i.type !== 'epic');
  const done = work.filter((i) => i.statusCategory === 'done').length;
  const m = methodologyOf(project);
  // A project switched to a flow method may still hold an old active sprint; don't advertise it.
  const sprint = m.features.sprints ? project.sprints.find((s) => s.state === 'active') : undefined;
  const activePhase = project.phases.find((ph) => ph.state === 'active' || ph.state === 'review');
  let phase = `${m.name} · ${m.features.sprints === 'required' ? `No active ${term(m.id, 'sprint').toLowerCase()} · Plan one in the backlog` : m.cadence}`;
  if (activePhase) phase = `${m.name} · ${term(m.id, 'phase')} ${activePhase.position + 1} of ${project.phases.length}: ${activePhase.name}${activePhase.state === 'review' ? ` · awaiting ${gateWord(m)} approval` : ''}`;
  if (sprint) {
    const left = sprint.endDate ? daysBetween(todayISO(), sprint.endDate) : null;
    phase = `${m.name} · ${sprint.name} · ${left == null ? 'In progress' : left > 0 ? `${left} day${left === 1 ? '' : 's'} remaining` : left === 0 ? 'Ends today' : `Ended ${fmtDate(sprint.endDate, locale)}`}`;
  }
  const people = members.filter((m) => issues.some((i) => i.assigneeId === m.id));
  return (
    <div className="project-hero scene" style={{ '--project-tint': project.color, ...sceneStyle(sceneFor(project.id)) } as CSSProperties}>
      <div className="hero-content">
        <div className="hero-overline"><Icon name="bolt" size={13} /> {phase}</div>
        <h2>{project.name}</h2>
        <p>{sprint?.goal || project.description || 'Everything your team is working on, in one place.'}</p>
      </div>
      <div className="hero-right">
        <div className="hero-metric"><strong>{work.length ? Math.round((done / work.length) * 100) : 0}%</strong><span>work completed</span></div>
        <div className="hero-people"><AvatarGroup users={people.length ? people : members} /></div>
      </div>
    </div>
  );
}

/** Mixes a project colour towards the prototype's deep indigo for the hero gradient midpoint. */

export function Metrics({ issues }: { issues: Issue[] }) {
  const work = issues.filter((i) => i.type !== 'epic');
  const today = todayISO();
  const done = work.filter((x) => x.statusCategory === 'done').length;
  const progress = work.filter((x) => x.statusCategory === 'progress').length;
  const overdue = work.filter((x) => x.dueDate && x.dueDate < today && x.statusCategory !== 'done').length;
  const weekDone = work.filter((x) => x.resolvedAt && daysBetween(x.resolvedAt.slice(0, 10), today) <= 7).length;
  const m: [string, number, string, string, string, string][] = [
    ['Total work items', work.length, 'All tracked tasks', 'grid', '#f2dcd0', '#d2895f'],
    ['Completed', done, weekDone ? `${weekDone} finished this week` : 'Moving forward', 'checkcircle', '#eaf3f2', '#448b82'],
    ['In progress', progress, 'Active workstream', 'loader', '#f0f5f9', '#829fb9'],
    ['Need attention', overdue, overdue ? 'Overdue items' : 'Nothing overdue', 'flag', '#fdf1ef', '#ce876f'],
  ];
  return (
    <div className="metric-grid">
      {m.map(([label, num, sub, ic, bg, color]) => (
        <div className="metric" key={label}>
          <div className="metric-head"><span>{label}</span><span className="metric-symbol" style={{ background: bg, color }}><Icon name={ic} size={17} /></span></div>
          <div className="metric-val">{num}</div>
          <div className="metric-foot"><span className="trend"><Icon name="trend" size={12} /></span> {sub}</div>
        </div>
      ))}
    </div>
  );
}

export function ViewTabs() {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const tabs = m.views.map((v) => [v, viewMeta(m, v).icon, viewMeta(m, v).label] as const);
  // When the tab bar scrolls (many views, narrow screens), keep the current tab in view.
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  return (
    <nav className="tabs" aria-label="Project views" ref={navRef}>
      {tabs.map(([to, icon, label]) => (
        <NavLink key={to} to={`../${to}`} relative="path" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <Icon name={icon} size={14} />{label}
        </NavLink>
      ))}
    </nav>
  );
}

export function SectionBar({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="section-bar">
      <div><span className="section-heading">{title}</span>{sub && <span className="section-sub">{sub}</span>}</div>
      <ViewTabs />
    </div>
  );
}

export function FilterBar({ count }: { count: number }) {
  const { filters, setFilters, issues, project } = useProjectCtx();
  const m = methodologyOf(project);
  const { members, me } = useWs();
  const labels = useMemo(() => [...new Set(issues.flatMap((i) => i.labels))].sort(), [issues]);
  const active = Object.values(filters).some(Boolean);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const assignees = members.filter((m) => issues.some((i) => i.assigneeId === m.id));
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <label className="search-box filter-search">
          <Icon name="search" size={15} />
          <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Filter work…" aria-label="Filter work items" />
        </label>
        <button className={`chip-toggle ${filters.assignee === 'me' ? 'on' : ''}`} aria-pressed={filters.assignee === 'me'} onClick={() => set({ assignee: filters.assignee === 'me' ? '' : 'me' })}>Only my items</button>
        <select className="filter-select" value={filters.assignee === 'me' ? '' : filters.assignee} onChange={(e) => set({ assignee: e.target.value })} aria-label="Filter by assignee">
          <option value="">All assignees</option>
          <option value="none">Unassigned</option>
          {assignees.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>)}
        </select>
        <select className="filter-select" value={filters.priority} onChange={(e) => set({ priority: e.target.value as Priority | '' })} aria-label="Filter by priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="filter-select hide-narrow" value={filters.type} onChange={(e) => set({ type: e.target.value as IssueType | '' })} aria-label="Filter by type">
          <option value="">All types</option>
          {(m.types as IssueType[]).map((t) => <option key={t} value={t}>{typeLabel(m, t)}</option>)}
        </select>
        {labels.length > 0 && (
          <select className="filter-select hide-narrow" value={filters.label} onChange={(e) => set({ label: e.target.value })} aria-label="Filter by label">
            <option value="">All labels</option>
            {labels.map((l) => <option key={l}>{l}</option>)}
          </select>
        )}
        {active && <button className="link-btn" onClick={() => setFilters(EMPTY)}>Clear filters</button>}
      </div>
      <div className="toolbar-right">
        <AvatarGroup users={assignees} />
        <span className="tiny-note">{count} work item{count === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

/** Index route: land on the methodology's primary view (e.g. Phases for Waterfall). */
export function ProjectIndex() {
  const { project } = useProjectCtx();
  return <Navigate to={methodologyOf(project).views[0]} replace />;
}

/** Redirects views a methodology doesn't use (e.g. Backlog in Kanban) to its primary view. */
export function RequireView({ view, children }: { view: string; children: React.ReactNode }) {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  if (!(m.views as string[]).includes(view)) return <Navigate to={`../${m.views[0]}`} relative="path" replace />;
  return <>{children}</>;
}
