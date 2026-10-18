import { memo, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PriorityPill } from '../../components/ui';
import { announcements } from '../../lib/dnd';
import { useMoveIssue, useUpdateIssue, invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast, toastError } from '../../lib/store';
import { api } from '../../lib/api';
import { fmtDate, todayISO } from '../../lib/format';
import { estimateLabel, methodologyOf, term, typeLabel, lower } from '../../lib/methodology';
import type { Issue, Status } from '../../lib/types';
import { FilterBar, SectionBar, useProjectCtx } from './ProjectLayout';

type Columns = Record<string, number[]>;
type Lane = { key: string; label: string; color?: string; patch: Partial<Pick<Issue, 'priority' | 'assigneeId' | 'epicId'>>; expedite?: boolean };
type LaneMode = 'none' | 'priority' | 'assignee' | 'epic';

const colKey = (lane: string, statusId: number) => `${lane}|${statusId}`;
const parseKey = (k: string) => { const i = k.lastIndexOf('|'); return { lane: k.slice(0, i), statusId: Number(k.slice(i + 1)) }; };

function laneOf(mode: LaneMode, i: Issue): string {
  if (mode === 'priority') return i.priority;
  if (mode === 'assignee') return String(i.assigneeId ?? 'none');
  if (mode === 'epic') return String(i.epicId ?? 'none');
  return 'all';
}

function buildColumns(statuses: Status[], lanes: Lane[], mode: LaneMode, issues: Issue[]): Columns {
  const cols: Columns = {};
  for (const l of lanes) for (const s of statuses) cols[colKey(l.key, s.id)] = [];
  [...issues].sort((a, b) => a.rank - b.rank).forEach((i) => cols[colKey(laneOf(mode, i), i.statusId)]?.push(i.id));
  return cols;
}

export function Board() {
  const { project, filtered, issues: allIssues } = useProjectCtx();
  const m = methodologyOf(project);
  const { canEdit, members } = useWs();
  const activeSprint = m.features.sprints ? project.sprints.find((s) => s.state === 'active') : undefined;
  const activePhase = project.phases.find((p) => p.state === 'active' || p.state === 'review');
  const [scope, setScope] = useState<string>(m.features.sprints === 'required' ? 'sprint' : m.phases && activePhase ? `phase-${activePhase.id}` : 'all');
  const sprintOnly = scope === 'sprint' && !!activeSprint;
  const phaseScope = scope.startsWith('phase-') ? Number(scope.slice(6)) : null;
  const [laneMode, setLaneModeState] = useState<LaneMode>((project.settings.swimlane ?? m.features.swimlane) as LaneMode);
  const qc = useQueryClient();
  const update = useUpdateIssue();
  const setLaneMode = (mode: LaneMode) => {
    setLaneModeState(mode);
    if (canEdit) api.patch(`/projects/${project.id}`, { swimlane: mode }).then(() => qc.invalidateQueries({ queryKey: ['project', project.id] })).catch(() => {});
  };

  const cards = useMemo(
    () => filtered.filter((i) => i.type !== 'epic' && i.type !== 'subtask' && (!sprintOnly || i.sprintId === activeSprint!.id) && (phaseScope == null || i.phaseId === phaseScope)),
    [filtered, sprintOnly, activeSprint, phaseScope],
  );
  const lanes = useMemo<Lane[]>(() => {
    if (laneMode === 'priority') {
      const flow = m.features.wip;
      return [
        { key: 'urgent', label: flow ? 'Expedite' : 'Urgent', color: '#e35d73', patch: { priority: 'urgent' as const }, expedite: flow },
        { key: 'high', label: 'High priority', color: '#e8875f', patch: { priority: 'high' as const } },
        { key: 'medium', label: flow ? 'Standard' : 'Medium priority', color: '#d6943e', patch: { priority: 'medium' as const } },
        { key: 'low', label: 'Low priority', color: '#229e80', patch: { priority: 'low' as const } },
      ].filter((l) => l.expedite || cards.some((c) => c.priority === l.key));
    }
    if (laneMode === 'assignee') {
      return [...members.filter((u) => cards.some((c) => c.assigneeId === u.id)).map((u) => ({ key: String(u.id), label: u.name, color: u.color, patch: { assigneeId: u.id } })),
        ...(cards.some((c) => !c.assigneeId) ? [{ key: 'none', label: 'Unassigned', patch: { assigneeId: null } }] : [])];
    }
    if (laneMode === 'epic') {
      const epics = allIssues.filter((i) => i.type === 'epic' && cards.some((c) => c.epicId === i.id));
      return [...epics.map((e) => ({ key: String(e.id), label: `${typeLabel(m, 'epic')}: ${e.title}`, patch: { epicId: e.id } })),
        ...(cards.some((c) => !c.epicId) ? [{ key: 'none', label: `No ${typeLabel(m, 'epic').toLowerCase()}`, patch: { epicId: null } }] : [])];
    }
    return [{ key: 'all', label: '', patch: {} }];
  }, [laneMode, cards, members, allIssues, m]);

  const byId = useMemo(() => new Map(cards.map((i) => [i.id, i])), [cards]);
  const [columns, setColumns] = useState<Columns>(() => buildColumns(project.statuses, lanes, laneMode, cards));
  const dndAnnouncements = useMemo(() => {
    const card = (id: string | number) => { const i = byId.get(Number(id)); return i ? `${i.key} ${i.title}` : 'the card'; };
    const column = (key: string) => project.statuses.find((st) => st.id === Number(key.split('|')[1]))?.name ?? 'a column';
    return announcements(card, (id) => (byId.has(Number(id)) ? `${column(Object.keys(columns).find((k) => columns[k].includes(Number(id))) ?? '')}, next to ${card(id)}` : column(String(id))));
  }, [byId, columns, project.statuses]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [origin, setOrigin] = useState<{ key: string; index: number } | null>(null);
  const move = useMoveIssue();

  // Server data is the source of truth whenever we're not mid-drag.
  useEffect(() => {
    if (dragging == null) setColumns(buildColumns(project.statuses, lanes, laneMode, cards));
  }, [cards, project.statuses, lanes, laneMode, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string | number): string | undefined => {
    if (typeof id === 'string' && id.startsWith('col-')) return id.slice(4);
    return Object.keys(columns).find((k) => columns[k].includes(Number(id)));
  };

  function onDragStart(e: DragStartEvent) {
    const id = Number(e.active.id);
    const key = findColumn(id);
    setDragging(id);
    setOrigin(key ? { key, index: columns[key].indexOf(id) } : null);
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(active.id);
    const to = findColumn(over.id);
    if (from == null || to == null || from === to) return;
    setColumns((cols) => {
      const fromList = cols[from].filter((x) => x !== Number(active.id));
      const toList = [...cols[to]];
      const overIndex = toList.indexOf(Number(over.id));
      toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, Number(active.id));
      return { ...cols, [from]: fromList, [to]: toList };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const id = Number(e.active.id);
    setDragging(null);
    const issue = byId.get(id);
    const over = e.over;
    if (!issue || !over) return setColumns(buildColumns(project.statuses, lanes, laneMode, cards));
    const to = findColumn(over.id);
    if (to == null) return;
    let list = columns[to];
    const oldIndex = list.indexOf(id);
    const overIndex = typeof over.id === 'number' ? list.indexOf(Number(over.id)) : list.length - 1;
    if (oldIndex !== overIndex && overIndex >= 0) {
      list = [...list];
      list.splice(oldIndex, 1);
      list.splice(overIndex, 0, id);
      setColumns((c) => ({ ...c, [to]: list }));
    }
    const idx = list.indexOf(id);
    if (origin && origin.key === to && origin.index === idx) return;
    const { lane, statusId } = parseKey(to);
    const before = list[idx - 1];
    const after = list[idx + 1];
    const rb = before ? byId.get(before)!.rank : null;
    const ra = after ? byId.get(after)!.rank : null;
    const rank = rb != null && ra != null ? (rb + ra) / 2 : rb != null ? rb + 1024 : ra != null ? ra - 1024 : issue.rank;
    const status = project.statuses.find((s) => s.id === statusId)!;
    const targetLane = lanes.find((l) => l.key === lane);
    if (targetLane && lane !== laneOf(laneMode, issue)) {
      update.mutate({ issue, patch: targetLane.patch });
      toast(`${issue.key} moved to ${targetLane.label}.`);
    }
    move.mutate({ issue, statusId, beforeId: before ?? null, afterId: after ?? null, rank });
    if (statusId !== issue.statusId) toast(`${issue.key} moved to ${status.name}.`);
  }

  const draggingIssue = dragging != null ? byId.get(dragging) : undefined;
  const statusCount = (s: Status) => lanes.reduce((a, l) => a + (columns[colKey(l.key, s.id)]?.length ?? 0), 0);
  const sprintName = term(m.id, 'sprint');

  return (
    <>
      <SectionBar title={m.phases ? `${term(m.id, 'phase')} board` : m.features.wip ? 'Flow board' : 'Project workspace'} sub={`${m.name} · ${m.tagline}`} />
      <FilterBar count={cards.length} />
      <div className="board-scope">
        {m.features.sprints && activeSprint && (
          <div className="tabs" role="group" aria-label="Board scope">
            <button className={`tab ${scope === 'sprint' ? 'active' : ''}`} aria-pressed={scope === 'sprint'} onClick={() => setScope('sprint')}><Icon name="bolt" size={13} />{activeSprint.name}</button>
            <button className={`tab ${scope === 'all' ? 'active' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All work</button>
          </div>
        )}
        {sprintOnly && activeSprint.goal && <span className="tiny-note"><b>Goal:</b> {activeSprint.goal}</span>}
        {m.features.sprints === 'required' && !activeSprint && (
          <div className="tip-box" style={{ flex: 1 }}><Icon name="lightbulb" size={17} /><span>No {sprintName.toLowerCase()} is running, so you’re seeing all work. <Link to="../backlog" relative="path">Plan and start a {sprintName.toLowerCase()}</Link> to focus the board.</span></div>
        )}
        {m.phases && project.phases.length > 0 && (
          <label className="row-8 scope-select"><Icon name="layers" size={14} />
            <select className="filter-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label={`${term(m.id, 'phase')} scope`}>
              <option value="all">All {lower(term(m.id, 'phases'))}</option>
              {project.phases.map((p) => <option key={p.id} value={`phase-${p.id}`}>{p.name}{p.state === 'active' || p.state === 'review' ? ' (current)' : p.state === 'complete' ? ' ✓' : ''}</option>)}
            </select>
          </label>
        )}
        {m.id === 'scrumban' && <ScrumbanTrigger statuses={project.statuses} issues={allIssues} />}
        <label className="row-8 scope-select lane-select"><span className="tiny-note">Swimlanes</span>
          <select className="filter-select" value={laneMode} onChange={(e) => setLaneMode(e.target.value as LaneMode)} aria-label="Swimlanes">
            <option value="none">None</option>
            <option value="priority">{m.features.wip ? 'Class of service' : 'Priority'}</option>
            <option value="assignee">Assignee</option>
            <option value="epic">{typeLabel(m, 'epic')}</option>
          </select>
        </label>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
        accessibility={{ announcements: dndAnnouncements, screenReaderInstructions: { draggable: 'To pick up a card, press Space. Use the arrow keys to move it between columns, then press Space again to drop it, or Escape to cancel.' } }}>
        <div className={laneMode === 'none' ? '' : 'swimlanes'}>
          {lanes.map((lane, li) => (
            <div key={lane.key} className={laneMode === 'none' ? '' : `swimlane ${lane.expedite ? 'expedite' : ''}`}>
              {laneMode !== 'none' && (
                <div className="swimlane-head">
                  <span className="col-dot" style={{ background: lane.color ?? 'var(--muted)' }} />
                  <b>{lane.label}</b>
                  <span className="col-count">{project.statuses.reduce((a, s) => a + (columns[colKey(lane.key, s.id)]?.length ?? 0), 0)}</span>
                  {lane.expedite && (() => {
                    const n = project.statuses.filter((s) => s.category === 'progress').reduce((a, s) => a + (columns[colKey(lane.key, s.id)]?.length ?? 0), 0);
                    return <span className={`tiny-note ${n > 1 ? 'overdue' : ''}`}>{n > 1 ? `${n} expedite items in progress — the policy is 1 at a time. Finish one before starting another.` : 'Urgent work jumps the queue — limit 1 in progress at a time.'}</span>;
                  })()}
                </div>
              )}
              <div className={`kanban ${laneMode !== 'none' ? 'in-lane' : ''}`} aria-label={lane.label ? `${lane.label} lane` : 'Kanban board'}>
                {project.statuses.map((s) => (
                  <Column key={s.id} laneKey={lane.key} status={s} ids={columns[colKey(lane.key, s.id)] ?? []} total={statusCount(s)} showTitle={laneMode === 'none' || li === 0}
                    byId={byId} canEdit={canEdit} sprintId={sprintOnly ? activeSprint!.id : null} phaseId={phaseScope} lanePatch={lane.patch} projectId={project.id} compact={laneMode !== 'none'} />
                ))}
              </div>
            </div>
          ))}
          {!lanes.length && <BoardEmpty />}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggingIssue ? <CardBody issue={draggingIssue} overlay /> : null}
        </DragOverlay>
      </DndContext>
      <p className="hint-line"><Icon name="lightbulb" size={14} /> {m.features.wip ? 'Pull work only when the next column is under its WIP limit. ' : ''}Drag cards between columns{laneMode !== 'none' ? ' and lanes' : ''} — or focus a card, press Space and use the arrow keys. On mobile, long-press to drag.</p>
    </>
  );
}

/** Scrumban's planning trigger: when Ready falls below its threshold, it's time to plan. */
function ScrumbanTrigger({ statuses, issues }: { statuses: Status[]; issues: Issue[] }) {
  const ready = statuses.find((s) => /ready/i.test(s.name));
  if (!ready) return null;
  const count = issues.filter((i) => i.statusId === ready.id && i.type !== 'epic' && !i.parentId).length;
  const threshold = Math.max(2, Math.ceil((ready.wipLimit ?? 10) / 3));
  const low = count < threshold;
  return (
    <span className={`trigger-chip ${low ? 'low' : ''}`} title={`Plan when ${ready.name} drops below ${threshold}`}>
      <Icon name={low ? 'flag' : 'checkcircle'} size={13} /> {ready.name}: {count}{ready.wipLimit ? ` / ${ready.wipLimit}` : ''}
      {low ? <> · <Link to="../backlog" relative="path">time to plan</Link></> : ' · healthy buffer'}
    </span>
  );
}

function Column({ laneKey, status, ids, total, showTitle, byId, canEdit, sprintId, phaseId, lanePatch, projectId, compact }: {
  laneKey: string; status: Status; ids: number[]; total: number; showTitle: boolean; byId: Map<number, Issue>; canEdit: boolean;
  sprintId: number | null; phaseId: number | null; lanePatch: Lane['patch']; projectId: number; compact: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${colKey(laneKey, status.id)}` });
  const [adding, setAdding] = useState(false);
  const wip = status.wipLimit;
  const wipState = wip == null ? '' : total > wip ? 'over' : total === wip ? 'at' : '';
  return (
    <section ref={setNodeRef} className={`kanban-col ${compact ? 'compact' : ''} ${isOver ? 'drag-over' : ''} ${wipState ? `wip-${wipState}` : ''}`} aria-label={`${status.name}: ${ids.length} work items`}>
      {showTitle ? (
        <div className="col-title">
          <span className="col-dot" style={{ background: status.color }} />
          <b>{status.name}</b>
          <span className="col-count" title={wip ? `WIP limit ${wip}` : undefined}>{total}{wip ? ` / ${wip}` : ''}</span>
          <Link to="../settings" relative="path" className="col-more icon-btn tiny" title="Edit columns" aria-label={`Edit ${status.name} column`}><Icon name="ellipsis" size={16} /></Link>
        </div>
      ) : <span className="sr-only">{status.name}</span>}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id) => {
          const issue = byId.get(id);
          return issue ? <SortableCard key={id} issue={issue} disabled={!canEdit} /> : null;
        })}
      </SortableContext>
      {!ids.length && !adding && !compact && <div className="col-empty">{status.category === 'done' ? 'Finished work lands here.' : 'Drop work here.'}</div>}
      {canEdit && (adding
        ? <QuickAdd statusId={status.id} sprintId={sprintId} phaseId={phaseId} lanePatch={lanePatch} projectId={projectId} onDone={() => setAdding(false)} />
        : <button className="add-card" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> {compact ? 'Add' : 'Add a card'}</button>)}
    </section>
  );
}

function QuickAdd({ statusId, sprintId, phaseId, lanePatch, projectId, onDone }: {
  statusId: number; sprintId: number | null; phaseId: number | null; lanePatch: Lane['patch']; projectId: number; onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return onDone();
    setBusy(true);
    try {
      const created = await api.post<Issue>(`/projects/${projectId}/issues`, { title: title.trim(), statusId, sprintId, phaseId, ...lanePatch });
      invalidateWork(qc);
      toast(`${created.key} created.`);
      setTitle('');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="quick-add" onSubmit={submit}>
      <textarea className="text-input" autoFocus rows={2} maxLength={200} value={title} readOnly={busy} aria-busy={busy} placeholder="What needs doing? Press Enter to add."
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); if (e.key === 'Escape') onDone(); }} onBlur={() => !title.trim() && onDone()} />
      <div className="row-8"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Add card</button><button type="button" className="btn btn-light btn-sm" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function SortableCard({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled });
  const [, setParams] = useSearchParams();
  const open = () => setParams((p) => { const n = new URLSearchParams(p); n.set('issue', issue.key); return n; });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'dragging' : ''}
      {...attributes} {...listeners} role="button" aria-roledescription="Draggable work item" aria-label={`${issue.key} ${issue.title}, ${issue.statusName}`}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); else listeners?.onKeyDown?.(e); }}>
      <CardBody issue={issue} />
    </div>
  );
}

export const CardBody = memo(function CardBody({ issue, overlay = false }: { issue: Issue; overlay?: boolean }) {
  const { member, locale, projects } = useWs();
  const m = methodologyOf(projects.find((p) => p.id === issue.projectId));
  const overdue = issue.dueDate && issue.dueDate < todayISO() && issue.statusCategory !== 'done';
  return (
    <article className={`task-card ${overlay ? 'overlay' : ''} ${issue.statusCategory === 'done' ? 'is-done' : ''}`}>
      <div className="card-top">
        <span className="issue-id">{issue.key} · {typeLabel(m, issue.type)}</span>
        <PriorityPill priority={issue.priority} />
      </div>
      <div className="task-title">{issue.title}</div>
      {issue.labels.length > 0 && <div className="task-labels">{issue.labels.map((l) => <span className="task-tag" key={l}>{l}</span>)}</div>}
      <div className="card-footer">
        <div className="card-meta">
          {issue.dueDate && <span className={overdue ? 'overdue' : ''} title={`Due ${fmtDate(issue.dueDate, locale, true)}`}><Icon name="calendar" size={13} />{fmtDate(issue.dueDate, locale)}</span>}
          {issue.checklistTotal > 0 && <span title="Checklist progress"><Icon name="checkcircle" size={13} /> {issue.checklistDone}/{issue.checklistTotal}</span>}
          {issue.commentCount > 0 && <span title="Comments"><Icon name="message" size={13} />{issue.commentCount}</span>}
          {issue.subtaskCount > 0 && <span title="Sub-tasks"><Icon name="list" size={13} />{issue.subtaskCount}</span>}
          {issue.storyPoints != null && <span className="points" title={estimateLabel(m)}>{issue.storyPoints}{m.features.estimation === 'hours' ? 'h' : ''}</span>}
        </div>
        <Avatar user={member(issue.assigneeId)} size="card-avatar" />
      </div>
    </article>
  );
});

export function BoardEmpty() {
  return <Empty title="No work yet" icon="board">Create your first work item to get started.</Empty>;
}
