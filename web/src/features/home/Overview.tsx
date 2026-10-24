import { useState, type CSSProperties } from 'react';
import { SCENES, sceneStyle } from '../../lib/scenes';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PageHeader, PriorityPill, TypeIcon } from '../../components/ui';
import { useActivity, useIssues, useMyIssues, useProject, useTodos } from '../../lib/queries';
import { useWs, useCurrentProject } from '../../lib/workspace';
import { openCreate, openGuide, ui } from '../../lib/store';
import { greeting, relativeDay, timeAgo, todayISO } from '../../lib/format';
import { Metrics, ProjectHero } from '../project/ProjectLayout';
import type { Activity } from '../../lib/types';

export function Overview() {
  const { me, workspace, projects, base, canEdit } = useWs();
  const current = useCurrentProject();
  const project = useProject(current?.id);
  const issues = useIssues(current?.id);
  const mine = useMyIssues(workspace.slug);
  const [, setParams] = useSearchParams();
  const today = todayISO();
  const upNext = (mine.data ?? []).filter((i) => i.statusCategory !== 'done' && i.type !== 'epic').slice(0, 6);
  const overdue = upNext.filter((i) => i.dueDate && i.dueDate < today).length;

  return (
    <>
      <PageHeader eyebrow="Workspace / Overview" title={`${greeting()}, ${me.name.split(' ')[0]}.`}
        subtitle={overdue ? `The big picture, beautifully clear — and ${overdue} of your items could use a nudge today.` : 'The big picture, beautifully clear. Track momentum without getting lost in the details.'}
        actions={<>
          <button className="btn btn-light" onClick={() => openGuide()}><Icon name="sparkles" size={16} /><span className="btn-label-mobile">Ask Mars guide</span></button>
          {canEdit && <button className="btn btn-primary" onClick={() => openCreate()}><Icon name="plus" size={16} /> Create task</button>}
        </>} />

      <GettingStarted />

      {!projects.length ? (
        <div className="content-card"><Empty icon="folder" title="No projects yet" action={canEdit && <button className="btn btn-primary" onClick={() => ui.set({ createProjectOpen: true })}><Icon name="plus" size={15} /> Create a project</button>}>Projects hold your team’s work. Create one to get going.</Empty></div>
      ) : (
        <>
          {project.data && issues.data && <><ProjectHero project={project.data} issues={issues.data} /><Metrics issues={issues.data} /></>}
          <div className="two-col">
            <div className="content-card">
              <div className="section-bar" style={{ marginTop: 0 }}>
                <div><h3>Up next for you</h3><p className="muted">Your open work across every project, soonest first</p></div>
                <Link className="btn btn-soft btn-sm" to={`${base}/my-tasks`}>All my tasks <Icon name="right" size={13} /></Link>
              </div>
              {upNext.map((t) => (
                <button key={t.id} className="todo-item clickable row-btn" onClick={() => setParams({ issue: t.key })}>
                  <TypeIcon type={t.type} size={15} />
                  <div className="todo-copy"><strong>{t.title}</strong><small>{t.key} · {t.statusName} · <span className={t.dueDate && t.dueDate < today ? 'overdue' : ''}>{t.dueDate ? `Due ${relativeDay(t.dueDate)}` : 'No due date'}</span></small></div>
                  <PriorityPill priority={t.priority} />
                </button>
              ))}
              {!upNext.length && <Empty title="You’re all clear" icon="checkcircle">Nothing is assigned to you right now. Enjoy the breathing room — or pick something from the board.</Empty>}
            </div>
            <div className="stack-16">
              <ProjectsCard />
              <div className="content-card scene scene-card" style={sceneStyle(SCENES[1]) as CSSProperties}>
                <div className="row-12">
                  <span className="metric-symbol"><Icon name="sparkles" size={18} /></span>
                  <div><h3>Need a fresh perspective?</h3><p className="muted">Your free Mars guide can plan your day or spot what’s at risk.</p></div>
                </div>
                <div className="row-8 wrap" style={{ marginTop: 14 }}>
                  <button className="btn btn-soft btn-sm" onClick={() => openGuide('Prioritise my day')}>Plan my day</button>
                  <button className="btn btn-soft btn-sm" onClick={() => openGuide('What needs attention?')}>What needs attention?</button>
                  <button className="btn btn-soft btn-sm" onClick={() => openGuide('Write my stand-up')}>Write my stand-up</button>
                </div>
              </div>
              <RecentActivity />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ProjectsCard() {
  const { projects, base } = useWs();
  return (
    <div className="content-card">
      <h3>Projects</h3>
      <p className="muted">{projects.length} active · progress at a glance</p>
      {projects.map((p) => {
        const pct = p.issueCount ? Math.round(((p.doneCount ?? 0) / p.issueCount) * 100) : 0;
        return (
          <Link key={p.id} to={`${base}/p/${p.key}`} className="project-row">
            <span className="project-glyph" style={{ background: p.color }}>{p.name[0]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row-between"><b className="ellipsis">{p.name}</b><small>{pct}%</small></span>
              <span className="dist-track"><span className="dist-fill" style={{ width: `${pct}%`, background: p.color, display: 'block' }} /></span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function describe(a: Activity, name: string) {
  const d = a.data as Record<string, string>;
  switch (a.verb) {
    case 'created': return <><b>{name}</b> created <i>{a.issueTitle ?? d.title}</i></>;
    case 'commented': return <><b>{name}</b> commented on <i>{a.issueKey}</i></>;
    case 'updated': return d.field === 'statusId' ? <><b>{name}</b> moved <i>{a.issueKey}</i> to {d.to}</> : <><b>{name}</b> updated <i>{a.issueKey}</i></>;
    case 'sprint_started': return <><b>{name}</b> started {d.name}</>;
    case 'sprint_completed': return <><b>{name}</b> completed {d.name}</>;
    case 'member_joined': return <><b>{d.name}</b> joined the workspace 👋</>;
    case 'project_created': return <><b>{name}</b> created project {d.name}</>;
    case 'workspace_created': return <><b>{name}</b> created this workspace</>;
    case 'deleted': return <><b>{name}</b> deleted {d.key}</>;
    case 'linked': return <><b>{name}</b> linked <i>{a.issueKey}</i> to {d.target}</>;
    default: return <><b>{name}</b> made a change</>;
  }
}

function RecentActivity() {
  const { workspace, member, locale } = useWs();
  const { data } = useActivity(workspace.slug);
  const [, setParams] = useSearchParams();
  return (
    <div className="content-card">
      <h3>Recent activity</h3>
      <p className="muted">What your team has been up to</p>
      <ul className="activity-feed">
        {(data ?? []).slice(0, 8).map((a) => (
          <li key={a.id}>
            <Avatar user={member(a.actorId)} size="sm" />
            <button className="link-plain" onClick={() => a.issueKey && setParams({ issue: a.issueKey })} disabled={!a.issueKey}>
              <span>{describe(a, member(a.actorId)?.name.split(' ')[0] ?? 'Someone')}</span>
              <small>{timeAgo(a.createdAt, locale)}</small>
            </button>
          </li>
        ))}
        {!data?.length && <li className="placeholder small">Activity will appear here as your team works.</li>}
      </ul>
    </div>
  );
}

/** First-run checklist. Steps tick themselves off from real data where possible. */
function GettingStarted() {
  const { workspace, members, base, me } = useWs();
  const key = `fs_tour_${workspace.slug}`;
  const [visible, setVisible] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const todos = useTodos(todayISO());
  const activity = useActivity(workspace.slug);
  const current = useCurrentProject();
  const navigate = useNavigate();
  if (!visible) return null;
  const mineMoved = (activity.data ?? []).some((a) => a.actorId === me.id && a.verb === 'updated');
  const created = (activity.data ?? []).some((a) => a.actorId === me.id && a.verb === 'created');
  let askedGuide = false;
  try { askedGuide = localStorage.getItem('fs_asked_guide') === '1'; } catch { /* storage blocked */ }
  const steps: [boolean, string, string, () => void][] = [
    [created, 'Create your first work item', 'Press C anywhere', () => openCreate()],
    [mineMoved, 'Move a card on the board', 'Drag it to the next column', () => current && navigate(`${base}/p/${current.key}/board`)],
    [members.length > 1, 'Invite a teammate', 'Free for unlimited people', () => ui.set({ inviteOpen: true })],
    [!!todos.data?.items.length, 'Plan your day', 'Add a to-do in My day', () => navigate(`${base}/my-day`)],
    [askedGuide, 'Ask the Mars guide', 'Try “prioritise my day”', () => openGuide('Prioritise my day')],
  ];
  const done = steps.filter((s) => s[0]).length;
  const dismiss = () => { try { localStorage.removeItem(key); } catch { /* */ } setVisible(false); };
  return (
    <div className="content-card getting-started">
      <div className="row-between card-scene scene" style={sceneStyle(SCENES[0]) as CSSProperties}>
        <div><h3>Getting started · {done}/{steps.length}</h3><p className="muted">Five small steps to feel at home in WorkMars.</p></div>
        <button className="icon-btn" onClick={dismiss} aria-label="Dismiss getting started"><Icon name="close" size={16} /></button>
      </div>
      <div className="sprint-progress" style={{ margin: '12px 0 4px' }}><i className="done" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <div className="gs-steps">
        {steps.map(([ok, title, hint, run]) => (
          <button key={title} className={`gs-step ${ok ? 'ok' : ''}`} onClick={run} disabled={ok}>
            <span className="gs-check">{ok ? <Icon name="check" size={13} /> : null}</span>
            <span><b>{title}</b><small>{hint}</small></span>
          </button>
        ))}
      </div>
      {done === steps.length && <div className="tip-box" style={{ marginTop: 12 }}><Icon name="heart" size={17} /><span>Brilliant — you’re all set! <button className="link-btn" onClick={dismiss}>Hide this card</button></span></div>}
    </div>
  );
}
