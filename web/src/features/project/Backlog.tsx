import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, StatusPill, TypeIcon, PriorityPill } from '../../components/ui';
import { announcements } from '../../lib/dnd';
import { api } from '../../lib/api';
import { invalidateWork, useMoveIssue } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { askConfirm, toast, toastError } from '../../lib/store';
import { fmtDate, daysBetween, todayISO, plural } from '../../lib/format';
import type { Issue, Sprint } from '../../lib/types';
import { estimateLabel, methodologyOf, term } from '../../lib/methodology';
import { FilterBar, SectionBar, useProjectCtx } from './ProjectLayout';

const BACKLOG = 'backlog';
type Containers = Record<string, number[]>;
const cid = (sprintId: number | null) => (sprintId == null ? BACKLOG : `s${sprintId}`);

export function Backlog() {
  const { project, filtered } = useProjectCtx();
  const { canEdit, locale } = useWs();
  const qc = useQueryClient();
  const move = useMoveIssue();
  const [starting, setStarting] = useState<Sprint | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);

  const openSprints = project.sprints.filter((s) => s.state !== 'closed');
  // Finished work stays with the sprint it was finished in; closed sprints aren't shown here.
  const closedIds = useMemo(() => new Set(project.sprints.filter((s) => s.state === 'closed').map((s) => s.id)), [project.sprints]);
  const items = useMemo(() => filtered.filter((i) => i.type !== 'epic' && i.type !== 'subtask'
    && !(i.statusCategory === 'done' && !i.sprintId) && !(i.sprintId && closedIds.has(i.sprintId))), [filtered, closedIds]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const build = (): Containers => {
    const c: Containers = { [BACKLOG]: [], ...Object.fromEntries(openSprints.map((s) => [cid(s.id), [] as number[]])) };
    [...items].sort((a, b) => a.rank - b.rank).forEach((i) => (c[cid(i.sprintId)] ?? c[BACKLOG]).push(i.id));
    return c;
  };
  const [containers, setContainers] = useState<Containers>(build);
  const [dragging, setDragging] = useState<number | null>(null);
  const dndAnnouncements = useMemo(() => {
    const row = (id: string | number) => { const i = byId.get(Number(id)); return i ? `${i.key} ${i.title}` : 'the work item'; };
    const group = (key: string) => (key === BACKLOG ? 'the backlog' : project.sprints.find((sp) => cid(sp.id) === key)?.name ?? 'a group');
    return announcements(row, (id, activeId) => {
      if (!byId.has(Number(id))) return group(String(id));
      const where = group(Object.keys(containers).find((k) => containers[k].includes(Number(id))) ?? BACKLOG);
      return id === activeId ? where : `${where}, next to ${row(id)}`;
    });
  }, [byId, containers, project.sprints]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (dragging == null) setContainers(build()); }, [items, project.sprints, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const findContainer = (id: string | number) => (typeof id === 'string' && id in containers ? id : Object.keys(containers).find((k) => containers[k].includes(Number(id))));

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findContainer(active.id);
    const to = findContainer(over.id);
    if (!from || !to || from === to) return;
    setContainers((c) => {
      const target = [...c[to]];
      const at = target.indexOf(Number(over.id));
      target.splice(at >= 0 ? at : target.length, 0, Number(active.id));
      return { ...c, [from]: c[from].filter((x) => x !== Number(active.id)), [to]: target };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const issue = byId.get(Number(active.id));
    if (!issue || !over) return;
    const to = findContainer(over.id);
    if (!to) return;
    const list = [...containers[to]];
    const from = list.indexOf(issue.id);
    const target = typeof over.id === 'number' ? list.indexOf(over.id) : from;
    if (from !== target && target >= 0) { list.splice(from, 1); list.splice(target, 0, issue.id); }
    setContainers((c) => ({ ...c, [to]: list }));
    const idx = list.indexOf(issue.id);
    const before = list[idx - 1];
    const after = list[idx + 1];
    const sprintId = to === BACKLOG ? null : Number(to.slice(1));
    const rb = before ? byId.get(before)?.rank ?? null : null;
    const ra = after ? byId.get(after)?.rank ?? null : null;
    const rank = rb != null && ra != null ? (rb + ra) / 2 : rb != null ? rb + 1024 : ra != null ? ra - 1024 : issue.rank;
    move.mutate({ issue, sprintId, beforeId: before ?? null, afterId: after ?? null, rank });
    if (sprintId !== issue.sprintId) toast(`${issue.key} moved to ${sprintId ? project.sprints.find((s) => s.id === sprintId)?.name : 'the backlog'}.`);
  }

  const W = term(methodologyOf(project).id, 'sprint');
  const createSprint = useMutation({
    mutationFn: () => api.post<Sprint>(`/projects/${project.id}/sprints`, {}),
    onSuccess: (s) => { invalidateWork(qc); toast(`${s.name} created — drag work into it.`); },
  });

  return (
    <>
      <SectionBar title={`Backlog & ${W.toLowerCase()}s`} sub={methodologyOf(project).features.sprints === 'optional' ? `${W}s are optional in ${methodologyOf(project).name} — pull straight to Ready, or plan an ${W.toLowerCase()} for rhythm` : 'Drag work to plan, reorder to prioritise'} />
      <FilterBar count={items.length} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} accessibility={{ announcements: dndAnnouncements }} onDragStart={(e) => setDragging(Number(e.active.id))} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {openSprints.map((s) => (
          <SprintBox key={s.id} sprint={s} ids={containers[cid(s.id)] ?? []} byId={byId} canEdit={canEdit} locale={locale}
            onStart={() => setStarting(s)} onComplete={() => setCompleting(s)} hasActive={openSprints.some((x) => x.state === 'active')} />
        ))}
        <Container id={BACKLOG} title="Backlog" ids={containers[BACKLOG]} byId={byId} canEdit={canEdit} sprintId={null}
          actions={canEdit && <button className="btn btn-light btn-sm" onClick={() => createSprint.mutate()} disabled={createSprint.isPending}><Icon name="plus" size={14} /> Create {W.toLowerCase()}</button>} />
        <DragOverlay>{dragging != null && byId.get(dragging) ? <Row issue={byId.get(dragging)!} overlay /> : null}</DragOverlay>
      </DndContext>
      <ClosedSprints sprints={project.sprints.filter((s) => s.state === 'closed')} />
      {starting && <StartSprintModal sprint={starting} points={sumPoints(containers[cid(starting.id)], byId)} onClose={() => setStarting(null)} />}
      {completing && <CompleteSprintModal sprint={completing} sprints={openSprints} items={(containers[cid(completing.id)] ?? []).map((id) => byId.get(id)!).filter(Boolean)} onClose={() => setCompleting(null)} />}
    </>
  );
}

const sumPoints = (ids: number[] = [], byId: Map<number, Issue>) => ids.reduce((a, id) => a + (byId.get(id)?.storyPoints ?? 0), 0);

function SprintBox({ sprint, ids, byId, canEdit, locale, onStart, onComplete, hasActive }: {
  sprint: Sprint; ids: number[]; byId: Map<number, Issue>; canEdit: boolean; locale: string; onStart: () => void; onComplete: () => void; hasActive: boolean;
}) {
  const qc = useQueryClient();
  const W = useSprintWord();
  const del = useMutation({ mutationFn: () => api.del(`/projects/${sprint.projectId}/sprints/${sprint.id}`), onSuccess: () => { invalidateWork(qc); toast(`${sprint.name} deleted. Its work is back in the backlog.`); } });
  const list = ids.map((id) => byId.get(id)!).filter(Boolean);
  const done = list.filter((i) => i.statusCategory === 'done').length;
  const progress = list.filter((i) => i.statusCategory === 'progress').length;
  const left = sprint.endDate ? daysBetween(todayISO(), sprint.endDate) : null;
  const meta = sprint.state === 'active'
    ? `${fmtDate(sprint.startDate, locale)} – ${fmtDate(sprint.endDate, locale)} · ${left != null && left >= 0 ? `${plural(left, 'day')} left` : 'Past end date'}`
    : 'Planned';
  return (
    <Container id={cid(sprint.id)} ids={ids} byId={byId} canEdit={canEdit} sprintId={sprint.id} highlight={sprint.state === 'active'}
      title={sprint.name}
      subtitle={<>{meta} · {plural(list.length, 'item')} · {sumPoints(ids, byId)} pts{sprint.goal && <> · <i>“{sprint.goal}”</i></>}</>}
      progress={list.length ? { done: (done / list.length) * 100, progress: (progress / list.length) * 100 } : undefined}
      actions={canEdit && (
        <>
          {sprint.state === 'active'
            ? <button className="btn btn-primary btn-sm" onClick={onComplete}><Icon name="checkcircle" size={14} /> Complete {W.toLowerCase()}</button>
            : <button className="btn btn-soft btn-sm" onClick={onStart} disabled={hasActive || !list.length} title={hasActive ? `Complete the active ${W.toLowerCase()} first` : !list.length ? 'Add work to start' : undefined}><Icon name="play" size={13} /> Start {W.toLowerCase()}</button>}
          {sprint.state === 'planned' && <button className="icon-btn tiny" aria-label={`Delete ${sprint.name}`} title={`Delete ${W.toLowerCase()}`} onClick={async () => (await askConfirm({ title: `Delete ${sprint.name}?`, body: 'Its work returns to the backlog.', confirmLabel: `Delete ${W.toLowerCase()}`, danger: true })) && del.mutate()}><Icon name="trash" size={15} /></button>}
        </>
      )} />
  );
}

function Container({ id, title, subtitle, ids, byId, canEdit, sprintId, actions, highlight, progress }: {
  id: string; title: string; subtitle?: React.ReactNode; ids: number[]; byId: Map<number, Issue>; canEdit: boolean; sprintId: number | null;
  actions?: React.ReactNode; highlight?: boolean; progress?: { done: number; progress: number };
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const W = useSprintWord();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={`content-card backlog-box ${highlight ? 'active-sprint' : ''} ${isOver ? 'drag-over' : ''}`} ref={setNodeRef} aria-label={title}>
      <div className="backlog-group-header">
        <button className="backlog-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <span style={{ transform: collapsed ? 'rotate(-90deg)' : undefined, display: 'inline-flex', transition: 'transform .15s' }}><Icon name="chevron" size={16} /></span>
          <span><b>{title}</b>{id === BACKLOG && <span className="muted-inline"> · {plural(ids.length, 'item')}</span>}{subtitle && <small className="backlog-sub">{subtitle}</small>}</span>
        </button>
        <div className="row-8">{actions}</div>
      </div>
      {progress && <div className="sprint-progress" aria-hidden="true"><i style={{ width: `${progress.done}%` }} className="done" /><i style={{ width: `${progress.progress}%` }} className="prog" /></div>}
      {!collapsed && (
        <>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="backlog-list">
              {ids.map((iid) => byId.get(iid) && <SortableRow key={iid} issue={byId.get(iid)!} disabled={!canEdit} />)}
              {!ids.length && <div className="backlog-empty">{id === BACKLOG ? 'Your backlog is clear. Capture ideas below.' : `Drag work items here to plan this ${W.toLowerCase()}.`}</div>}
            </div>
          </SortableContext>
          {canEdit && <InlineCreate sprintId={sprintId} />}
        </>
      )}
    </section>
  );
}

function SortableRow({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled });
  const [, setParams] = useSearchParams();
  const open = () => setParams((p) => { const n = new URLSearchParams(p); n.set('issue', issue.key); return n; });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'dragging' : ''} {...attributes} {...listeners}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); else listeners?.onKeyDown?.(e); }} aria-label={`${issue.key} ${issue.title}`}>
      <Row issue={issue} />
    </div>
  );
}

function Row({ issue, overlay }: { issue: Issue; overlay?: boolean }) {
  const { member, projects } = useWs();
  const m = methodologyOf(projects.find((p) => p.id === issue.projectId));
  return (
    <div className={`backlog-row ${overlay ? 'overlay' : ''}`}>
      <span className="grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
      <TypeIcon type={issue.type} size={13} />
      <span className="issue-id">{issue.key}</span>
      <span className={`backlog-title ${issue.statusCategory === 'done' ? 'struck' : ''}`}>{issue.title}</span>
      <span className="backlog-tags">{issue.labels.slice(0, 2).map((l) => <span className="task-tag" key={l}>{l}</span>)}</span>
      <PriorityPill priority={issue.priority} />
      <StatusPill name={issue.statusName} category={issue.statusCategory} />
      <span className="points" title={estimateLabel(m)}>{issue.storyPoints ?? '–'}</span>
      <Avatar user={member(issue.assigneeId)} size="sm" />
    </div>
  );
}

function InlineCreate({ sprintId }: { sprintId: number | null }) {
  const { project } = useProjectCtx();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    try {
      const created = await api.post<Issue>(`/projects/${project.id}/issues`, { title: title.trim(), sprintId });
      setTitle('');
      invalidateWork(qc);
      toast(`${created.key} added.`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="inline-create" onSubmit={submit}>
      <Icon name="plus" size={15} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a work item — press Enter" maxLength={200} readOnly={busy} aria-busy={busy} aria-label="New work item title" />
    </form>
  );
}

function StartSprintModal({ sprint, points, onClose }: { sprint: Sprint; points: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ goal: sprint.goal, weeks: 2 });
  const W = useSprintWord();
  const start = useMutation({
    mutationFn: () => api.post(`/projects/${sprint.projectId}/sprints/${sprint.id}/start`, form),
    onSuccess: () => { invalidateWork(qc); toast(`${sprint.name} has started. Good luck! 🚀`); onClose(); },
  });
  return (
    <Modal title={`Start ${sprint.name}`} subtitle={`${points} story points planned`} onClose={onClose}
      footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => start.mutate()} disabled={start.isPending}><Icon name="play" size={13} /> Start {W.toLowerCase()}</button></>}>
      <div className="modal-body">
        <label className="form-field"><span>{W} goal</span><input className="text-input" data-autofocus value={form.goal} maxLength={240} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder={`What will this ${W.toLowerCase()} achieve?`} /></label>
        <label className="form-field" style={{ marginTop: 14 }}><span>Duration</span>
          <select className="field-select" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{plural(w, 'week')}</option>)}
          </select>
        </label>
        <div className="tip-box" style={{ marginTop: 16 }}><Icon name="lightbulb" size={17} /><span>A clear, single-sentence goal helps the team make trade-offs when surprises happen.</span></div>
      </div>
    </Modal>
  );
}

function CompleteSprintModal({ sprint, sprints, items, onClose }: { sprint: Sprint; sprints: Sprint[]; items: Issue[]; onClose: () => void }) {
  const qc = useQueryClient();
  const open = items.filter((i) => i.statusCategory !== 'done');
  const W = useSprintWord();
  const planned = sprints.filter((s) => s.state === 'planned');
  const [moveTo, setMoveTo] = useState<string>(planned[0] ? String(planned[0].id) : 'backlog');
  const complete = useMutation({
    mutationFn: () => api.post<{ completedIssues: number; movedIssues: number; completed: number }>(`/projects/${sprint.projectId}/sprints/${sprint.id}/complete`, { moveTo: /^\d+$/.test(moveTo) ? Number(moveTo) : moveTo }),
    onSuccess: (r) => { invalidateWork(qc); toast(`${sprint.name} complete — ${r.completedIssues} done, ${r.completed} points delivered. 🎉`); onClose(); },
  });
  return (
    <Modal title={`Complete ${sprint.name}`} subtitle={`${items.length - open.length} of ${items.length} work items done`} onClose={onClose}
      footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => complete.mutate()} disabled={complete.isPending}>Complete {W.toLowerCase()}</button></>}>
      <div className="modal-body">
        {open.length ? (
          <>
            <p className="page-subtitle" style={{ marginTop: 0 }}>{plural(open.length, 'item')} {open.length === 1 ? 'is' : 'are'} unfinished. Where should {open.length === 1 ? 'it' : 'they'} go?</p>
            <select className="field-select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move unfinished work to">
              {planned.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="new">A new {W.toLowerCase()}</option>
              <option value="backlog">The backlog</option>
            </select>
          </>
        ) : <p className="page-subtitle" style={{ marginTop: 0 }}>Everything is done. Brilliant work, team! 🎉</p>}
        <div className="tip-box" style={{ marginTop: 16 }}><Icon name="chart" size={17} /><span>Completed points are recorded for your velocity chart in Reports.</span></div>
      </div>
    </Modal>
  );
}

function ClosedSprints({ sprints }: { sprints: Sprint[] }) {
  const { locale } = useWs();
  const W = useSprintWord();
  if (!sprints.length) return null;
  return (
    <details className="content-card closed-sprints">
      <summary><b>Completed {W.toLowerCase()}s</b> <span className="muted-inline">· {sprints.length}</span></summary>
      {sprints.map((s) => (
        <div className="setting-row" key={s.id}>
          <div><strong>{s.name}</strong><small>Completed {fmtDate(s.completedAt?.slice(0, 10), locale, true)}{s.goal ? ` · “${s.goal}”` : ''}</small></div>
          <span className="status-pill done">{s.completedPoints ?? 0} / {s.committedPoints ?? 0} pts</span>
        </div>
      ))}
    </details>
  );
}

function useSprintWord() {
  const { project } = useProjectCtx();
  return term(methodologyOf(project).id, 'sprint');
}
