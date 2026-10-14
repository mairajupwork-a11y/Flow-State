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
import { useMoveIssue, invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast, toastError } from '../../lib/store';
import { api } from '../../lib/api';
import { fmtDate, todayISO, TYPE_LABEL } from '../../lib/format';
import type { Issue, Status } from '../../lib/types';
import { FilterBar, SectionBar, useProjectCtx } from './ProjectLayout';

type Columns = Record<number, number[]>;

function buildColumns(statuses: Status[], issues: Issue[]): Columns {
  const cols: Columns = Object.fromEntries(statuses.map((s) => [s.id, [] as number[]]));
  [...issues].sort((a, b) => a.rank - b.rank).forEach((i) => cols[i.statusId]?.push(i.id));
  return cols;
}

export function Board() {
  const { project, filtered } = useProjectCtx();
  const { canEdit } = useWs();
  const activeSprint = project.sprints.find((s) => s.state === 'active');
  const [scope, setScope] = useState<'sprint' | 'all'>('sprint');
  const sprintOnly = project.template === 'scrum' && scope === 'sprint' && !!activeSprint;

  const cards = useMemo(
    () => filtered.filter((i) => i.type !== 'epic' && i.type !== 'subtask' && (!sprintOnly || i.sprintId === activeSprint!.id)),
    [filtered, sprintOnly, activeSprint],
  );
  const byId = useMemo(() => new Map(cards.map((i) => [i.id, i])), [cards]);
  const [columns, setColumns] = useState<Columns>(() => buildColumns(project.statuses, cards));
  const [dragging, setDragging] = useState<number | null>(null);
  const move = useMoveIssue();

  // Server data is the source of truth whenever we're not mid-drag.
  useEffect(() => {
    if (dragging == null) setColumns(buildColumns(project.statuses, cards));
  }, [cards, project.statuses, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string | number): number | undefined => {
    if (typeof id === 'string' && id.startsWith('col-')) return Number(id.slice(4));
    return Number(Object.keys(columns).find((k) => columns[Number(k)].includes(Number(id))));
  };

  function onDragStart(e: DragStartEvent) {
    setDragging(Number(e.active.id));
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
    if (!issue || !over) return setColumns(buildColumns(project.statuses, cards));
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
    const before = list[idx - 1];
    const after = list[idx + 1];
    if (to === issue.statusId && before === prevNeighbour(issue, cards, -1) && after === prevNeighbour(issue, cards, 1)) return;
    const rb = before ? byId.get(before)!.rank : null;
    const ra = after ? byId.get(after)!.rank : null;
    const rank = rb != null && ra != null ? (rb + ra) / 2 : rb != null ? rb + 1024 : ra != null ? ra - 1024 : issue.rank;
    const status = project.statuses.find((s) => s.id === to)!;
    move.mutate({ issue, statusId: to, beforeId: before ?? null, afterId: after ?? null, rank });
    if (to !== issue.statusId) toast(`${issue.key} moved to ${status.name}.`);
  }

  const draggingIssue = dragging != null ? byId.get(dragging) : undefined;

  return (
    <>
      <SectionBar title="Project workspace" sub="Everything in motion, at a glance" />
      <FilterBar count={cards.length} />
      {project.template === 'scrum' && (
        <div className="board-scope">
          {activeSprint ? (
            <>
              <div className="tabs" role="group" aria-label="Board scope">
                <button className={`tab ${scope === 'sprint' ? 'active' : ''}`} aria-pressed={scope === 'sprint'} onClick={() => setScope('sprint')}><Icon name="bolt" size={13} />{activeSprint.name}</button>
                <button className={`tab ${scope === 'all' ? 'active' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All work</button>
              </div>
              {activeSprint.goal && <span className="tiny-note"><b>Goal:</b> {activeSprint.goal}</span>}
            </>
          ) : (
            <div className="tip-box" style={{ flex: 1 }}><Icon name="lightbulb" size={17} /><span>No sprint is running, so you’re seeing all work. <Link to="../backlog" relative="path">Plan and start a sprint</Link> to focus the board.</span></div>
          )}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
        accessibility={{ screenReaderInstructions: { draggable: 'To pick up a card, press Space. Use the arrow keys to move it between columns, then press Space again to drop it, or Escape to cancel.' } }}>
        <div className="kanban" aria-label="Kanban board">
          {project.statuses.map((s) => (
            <Column key={s.id} status={s} ids={columns[s.id] ?? []} byId={byId} canEdit={canEdit} sprintId={sprintOnly ? activeSprint!.id : null} projectId={project.id} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggingIssue ? <CardBody issue={draggingIssue} overlay /> : null}
        </DragOverlay>
      </DndContext>
      <p className="hint-line"><Icon name="lightbulb" size={14} /> Drag cards between columns — or focus a card, press Space and use the arrow keys. On mobile, long-press to drag.</p>
    </>
  );
}

function prevNeighbour(issue: Issue, all: Issue[], dir: -1 | 1): number | undefined {
  const list = all.filter((i) => i.statusId === issue.statusId).sort((a, b) => a.rank - b.rank);
  return list[list.indexOf(issue) + dir]?.id;
}

function Column({ status, ids, byId, canEdit, sprintId, projectId }: { status: Status; ids: number[]; byId: Map<number, Issue>; canEdit: boolean; sprintId: number | null; projectId: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status.id}` });
  const [adding, setAdding] = useState(false);
  const wip = status.wipLimit;
  const wipState = wip == null ? '' : ids.length > wip ? 'over' : ids.length === wip ? 'at' : '';
  return (
    <section ref={setNodeRef} className={`kanban-col ${isOver ? 'drag-over' : ''} ${wipState ? `wip-${wipState}` : ''}`} aria-label={`${status.name}: ${ids.length} work items`}>
      <div className="col-title">
        <span className="col-dot" style={{ background: status.color }} />
        <b>{status.name}</b>
        <span className="col-count" title={wip ? `WIP limit ${wip}` : undefined}>{ids.length}{wip ? ` / ${wip}` : ''}</span>
        <Link to="../settings" relative="path" className="col-more icon-btn tiny" title="Edit columns" aria-label={`Edit ${status.name} column`}><Icon name="ellipsis" size={16} /></Link>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((id) => {
          const issue = byId.get(id);
          return issue ? <SortableCard key={id} issue={issue} disabled={!canEdit} /> : null;
        })}
      </SortableContext>
      {!ids.length && !adding && <div className="col-empty">{status.category === 'done' ? 'Finished work lands here.' : 'Drop work here.'}</div>}
      {canEdit && (adding
        ? <QuickAdd statusId={status.id} sprintId={sprintId} projectId={projectId} onDone={() => setAdding(false)} />
        : <button className="add-card" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add a task</button>)}
    </section>
  );
}

function QuickAdd({ statusId, sprintId, projectId, onDone }: { statusId: number; sprintId: number | null; projectId: number; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return onDone();
    setBusy(true);
    try {
      const created = await api.post<Issue>(`/projects/${projectId}/issues`, { title: title.trim(), statusId, sprintId });
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
      <textarea className="text-input" autoFocus rows={2} maxLength={200} value={title} disabled={busy} placeholder="What needs doing? Press Enter to add."
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
  const { member, locale } = useWs();
  const overdue = issue.dueDate && issue.dueDate < todayISO() && issue.statusCategory !== 'done';
  return (
    <article className={`task-card ${overlay ? 'overlay' : ''} ${issue.statusCategory === 'done' ? 'is-done' : ''}`}>
      <div className="card-top">
        <span className="issue-id">{issue.key} · {TYPE_LABEL[issue.type]}</span>
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
          {issue.storyPoints != null && <span className="points" title="Story points">{issue.storyPoints}</span>}
        </div>
        <Avatar user={member(issue.assigneeId)} size="card-avatar" />
      </div>
    </article>
  );
});

export function BoardEmpty() {
  return <Empty title="No work yet" icon="board">Create your first work item to get started.</Empty>;
}
