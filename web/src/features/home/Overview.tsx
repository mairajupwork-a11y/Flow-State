import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PageHeader, PriorityGlyph } from '../../components/ui';
import { useActivity, useIssues, useMyIssues, useProject, useTodos } from '../../lib/queries';
import { useWs, useCurrentProject } from '../../lib/workspace';
import { openCreate, openGuide, ui } from '../../lib/store';
import { PRIORITY_LABEL, greeting, relativeDay, timeAgo, todayISO } from '../../lib/format';
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
        subtitle={overdue ? `${overdue} of your items could use a nudge today.` : 'Here’s where things stand today.'}
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
          <div className="dash-grid">
            <div className="content-card dash-card">
              <div className="dash-card-head">
                <h3><span className="dash-ico lime"><Icon name="target" size={15} /></span> Up next for you</h3>
                <Link className="link-btn" to={`${base}/my-tasks`}>All my tasks</Link>
              </div>
              <div className="next-list">
                {upNext.map((t) => {
                  const late = !!t.dueDate && t.dueDate < today;
                  return (
                    <button key={t.id} className="next-row" onClick={() => setParams({ issue: t.key })}>
                      <span className={`prio-dot ${t.priority}`} title={`${PRIORITY_LABEL[t.priority]} priority`}><PriorityGlyph priority={t.priority} size={14} /></span>
                      <span className="next-copy"><b>{t.title}</b><small>{t.key} · {t.statusName}</small></span>
                      <span className={`due-chip ${late ? 'late' : ''}`}><Icon name="calendar" size={12} />{t.dueDate ? relativeDay(t.dueDate) : 'No date'}</span>
                    </button>
                  );
                })}
              </div>
              {!upNext.length && <Empty title="You’re all clear" icon="checkcircle">Nothing is assigned to you right now.</Empty>}
            </div>
            <div className="dash-side">
              <ProjectsCard />
              <div className="content-card dash-card guide-card">
                <h3><span className="dash-ico violet"><Icon name="sparkles" size={15} /></span> Mars guide</h3>
                <p className="muted">Free AI that reads your board.</p>
                <div className="guide-chips">
                  <button onClick={() => openGuide('Prioritise my day')}><Icon name="sun" size={13} /> Plan my day</button>
                  <button onClick={() => openGuide('What needs attention?')}><Icon name="flag" size={13} /> What needs attention?</button>
                  <button onClick={() => openGuide('Write my stand-up')}><Icon name="message" size={13} /> Write my stand-up</button>
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
    <div className="content-card dash-card">
      <div className="dash-card-head"><h3><span className="dash-ico sky"><Icon name="folder" size={15} /></span> Projects</h3><span className="muted">{projects.length} active</span></div>
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
    case 'dev_linked': return <>{d.provider} linked {d.kind === 'pr' ? 'a pull request' : `a ${d.kind}`} to <i>{a.issueKey}</i></>;
    case 'imported': return <><b>{name}</b> imported {String(d.count)} work items into {d.name}</>;
    case 'resources_updated': return <><b>{name}</b> updated the team on {d.name}</>;
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
    <div className="content-card dash-card">
      <h3><span className="dash-ico peach"><Icon name="clock" size={15} /></span> Recent activity</h3>
      <ul className="activity-feed">
        {(data ?? []).slice(0, 5).map((a) => (
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
      <div className="row-between">
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
