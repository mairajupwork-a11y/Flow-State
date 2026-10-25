import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, PriorityPill, RichText, Spinner, StatusPill, TypeIcon } from '../../components/ui';
import { api } from '../../lib/api';
import { invalidateWork, keys, useIssue, useIssues, useProject } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { askConfirm, copyText, openCreate, toast, toastError } from '../../lib/store';
import { PRIORITIES, PRIORITY_LABEL, fmtDate, timeAgo, todayISO } from '../../lib/format';
import { estimateLabel, methodologyOf, term, typeLabel } from '../../lib/methodology';
import type { Activity, IssueDetail, IssueType, Priority } from '../../lib/types';
import { Attachments, CustomFields, googleCalendarLink } from './IssueExtras';

export function IssueModal({ issueRef, onClose }: { issueRef: string; onClose: () => void }) {
  const { data: issue, error, isLoading } = useIssue(issueRef);
  if (isLoading) return <Modal title="Loading…" onClose={onClose} wide><div className="modal-body"><Spinner /></div></Modal>;
  if (error || !issue) {
    return (
      <Modal title="Work item not found" onClose={onClose}>
        <div className="modal-body"><p className="page-subtitle" style={{ marginTop: 0 }}>{issueRef} may have been deleted, or you may not have access to it.</p></div>
      </Modal>
    );
  }
  return <IssueDetailView issue={issue} onClose={onClose} />;
}

function IssueDetailView({ issue, onClose }: { issue: IssueDetail; onClose: () => void }) {
  const { member, members, me, canEdit, locale, workspace } = useWs();
  const project = useProject(issue.projectId).data;
  const siblings = useIssues(issue.projectId).data ?? [];
  const qc = useQueryClient();
  const [, setParams] = useSearchParams();
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(issue.description);
  useEffect(() => { setTitle(issue.title); setDesc(issue.description); }, [issue.title, issue.description]);

  const refresh = (data?: IssueDetail) => {
    if (data) qc.setQueryData(keys.issue(issue.key), data);
    invalidateWork(qc);
  };
  const patch = useMutation({
    mutationFn: (body: object) => api.patch(`/issues/${issue.key}`, body),
    onMutate: (body) => qc.setQueryData<IssueDetail>(keys.issue(issue.key), (d) => d && { ...d, ...body }),
    onSettled: () => refresh(),
    onError: (e) => { toastError(e); refresh(); },
  });
  const post = useMutation({ mutationFn: ({ path, body }: { path: string; body: object }) => api.post<IssueDetail>(`/issues/${issue.key}${path}`, body), onSuccess: refresh });
  const edit = useMutation({ mutationFn: ({ path, body }: { path: string; body: object }) => api.patch<IssueDetail>(`/issues/${issue.key}${path}`, body), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (path: string) => api.del<IssueDetail>(`/issues/${issue.key}${path}`), onSuccess: (d) => refresh(d as IssueDetail) });

  const deleteIssue = useMutation({
    mutationFn: () => api.del(`/issues/${issue.key}`),
    onSuccess: () => { invalidateWork(qc); toast(`${issue.key} deleted.`); onClose(); },
  });
  const addToDay = useMutation({
    mutationFn: () => api.post('/todos', { text: issue.title, issueRef: issue.key, day: todayISO() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['todos'] }); toast('Pinned to My day.'); },
  });

  const m = methodologyOf(project);
  const epic = siblings.find((s) => s.id === issue.epicId);
  const parent = siblings.find((s) => s.id === issue.parentId);
  const epics = siblings.filter((s) => s.type === 'epic' && s.id !== issue.id);
  const watching = issue.watchers.includes(me.id);
  const overdue = issue.dueDate && issue.dueDate < todayISO() && issue.statusCategory !== 'done';
  const openOther = (key: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('issue', key); return n; });

  const saveTitle = () => { setEditingTitle(false); if (title.trim() && title.trim() !== issue.title) patch.mutate({ title: title.trim() }); else setTitle(issue.title); };
  const saveDesc = () => { setEditingDesc(false); if (desc !== issue.description) patch.mutate({ description: desc }); };

  const header = (
    <span className="issue-head">
      {editingTitle ? (
        <input className="text-input title-input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { e.stopPropagation(); setTitle(issue.title); setEditingTitle(false); } }} aria-label="Title" />
      ) : (
        <button className="title-btn" onClick={() => canEdit && setEditingTitle(true)} disabled={!canEdit} title={canEdit ? 'Click to edit' : undefined}>{issue.title}</button>
      )}
    </span>
  );

  return (
    <Modal wide onClose={onClose} title={header} subtitle={
      <span className="detail-crumbs">
        {project && <span>{project.name}</span>}
        {epic && <><Icon name="right" size={11} /><button className="link-btn" onClick={() => openOther(epic.key)}>{epic.key} {epic.title}</button></>}
        {parent && <><Icon name="right" size={11} /><button className="link-btn" onClick={() => openOther(parent.key)}>{parent.key}</button></>}
      </span>
    }>
      <div className="modal-body">
        <div className="detail-meta">
          <TypeIcon type={issue.type} />
          <span className="issue-id">{issue.key} · {typeLabel(m, issue.type)}</span>
          <StatusPill name={issue.statusName} category={issue.statusCategory} />
          <PriorityPill priority={issue.priority} suffix=" priority" />
          {overdue && <span className="priority urgent"><Icon name="clock" size={11} /> Overdue</span>}
          <span className="detail-actions">
            <button className="btn btn-light btn-sm" onClick={() => copyText(`${location.origin}/w/${workspace.slug}/p/${project?.key}/board?issue=${issue.key}`, 'Link copied.')}><Icon name="link" size={13} /> Copy link</button>
            <button className="btn btn-light btn-sm" onClick={() => post.mutate({ path: '/watch', body: { watching: !watching } })} aria-pressed={watching}><Icon name="eye" size={13} /> {watching ? 'Watching' : 'Watch'}</button>
            <button className="btn btn-light btn-sm" onClick={() => addToDay.mutate()}><Icon name="sun" size={13} /> Add to My day</button>
            {issue.dueDate && <a className="btn btn-light btn-sm" target="_blank" rel="noopener noreferrer" href={googleCalendarLink(issue, `${location.origin}/w/${workspace.slug}?issue=${issue.key}`)}><Icon name="calendar" size={13} /> Add to Google Calendar</a>}
          </span>
        </div>

        <div className="detail-layout">
          <div style={{ minWidth: 0 }}>
            <div className="detail-section">
              <h4>Description</h4>
              {editingDesc ? (
                <>
                  <textarea className="text-input field-textarea" autoFocus rows={7} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Add context, requirements or acceptance criteria…"
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDesc(issue.description); setEditingDesc(false); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDesc(); }} />
                  <div className="row-8" style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={saveDesc}>Save</button><button className="btn btn-light btn-sm" onClick={() => { setDesc(issue.description); setEditingDesc(false); }}>Cancel</button><span className="tiny-note">⌘/Ctrl + Enter to save</span></div>
                </>
              ) : (
                <div className={`desc-view ${canEdit ? 'editable' : ''}`} role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : -1} onClick={() => canEdit && setEditingDesc(true)} onKeyDown={(e) => e.key === 'Enter' && canEdit && setEditingDesc(true)}>
                  {issue.description ? <p><RichText text={issue.description} /></p> : <p className="placeholder">{canEdit ? 'Add a description…' : 'No description added yet.'}</p>}
                </div>
              )}
            </div>

            <Checklist issue={issue} canEdit={canEdit} onAdd={(text) => post.mutate({ path: '/checklist', body: { text } })}
              onToggle={(id, done) => edit.mutate({ path: `/checklist/${id}`, body: { done } })} onRemove={(id) => remove.mutate(`/checklist/${id}`)} />

            {issue.type !== 'subtask' && issue.type !== 'epic' && (
              <div className="detail-section">
                <div className="row-between"><h4>Sub-tasks {issue.subtasks.length > 0 && <span className="muted-inline">· {issue.subtasks.filter((s) => s.statusCategory === 'done').length}/{issue.subtasks.length}</span>}</h4>
                  {canEdit && <button className="link-btn" onClick={() => openCreate({ type: 'subtask', parentId: issue.id, projectId: issue.projectId, sprintId: issue.sprintId })}><Icon name="plus" size={13} /> Add sub-task</button>}</div>
                {issue.subtasks.map((s) => <MiniRow key={s.id} issue={s} onOpen={() => openOther(s.key)} />)}
                {!issue.subtasks.length && <p className="placeholder small">Break bigger work into pieces with their own owner and status.</p>}
              </div>
            )}

            {issue.type === 'epic' && (
              <div className="detail-section">
                <h4>Work in this {typeLabel(m, 'epic').toLowerCase()} <span className="muted-inline">· {issue.children.filter((s) => s.statusCategory === 'done').length}/{issue.children.length} done</span></h4>
                {issue.children.length > 0 && <div className="dist-track" style={{ marginBottom: 10 }}><div className="dist-fill" style={{ width: `${(issue.children.filter((s) => s.statusCategory === 'done').length / issue.children.length) * 100}%`, background: 'var(--teal)' }} /></div>}
                {issue.children.map((s) => <MiniRow key={s.id} issue={s} onOpen={() => openOther(s.key)} />)}
                {canEdit && <button className="link-btn" onClick={() => openCreate({ epicId: issue.id, projectId: issue.projectId })}><Icon name="plus" size={13} /> Add work to this {typeLabel(m, 'epic').toLowerCase()}</button>}
              </div>
            )}

            <Attachments issue={issue} canEdit={canEdit} />

            <Links issue={issue} canEdit={canEdit} onOpen={openOther} onAdd={(target, kind) => post.mutateAsync({ path: '/links', body: { target, kind } })} onRemove={(id) => remove.mutate(`/links/${id}`)} />

            <div className="detail-section">
              <div className="tabs" role="tablist" style={{ marginBottom: 6 }}>
                <button role="tab" aria-selected={tab === 'comments'} className={`tab ${tab === 'comments' ? 'active' : ''}`} onClick={() => setTab('comments')}><Icon name="message" size={13} /> Comments {issue.comments.length || ''}</button>
                <button role="tab" aria-selected={tab === 'activity'} className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}><Icon name="clock" size={13} /> History</button>
              </div>
              {tab === 'comments'
                ? <Comments issue={issue} canEdit={canEdit} onPost={(body) => post.mutateAsync({ path: '/comments', body: { body } })}
                    onEdit={(id, body) => edit.mutate({ path: `/comments/${id}`, body: { body } })} onDelete={(id) => remove.mutate(`/comments/${id}`)} />
                : <History activity={issue.activity} />}
            </div>
          </div>

          <aside className="detail-aside">
            <fieldset disabled={!canEdit} className="plain">
              <label className="form-field"><span>Status</span>
                <select className="field-select" value={issue.statusId} onChange={(e) => patch.mutate({ statusId: Number(e.target.value) })}>
                  {project?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Assignee</span>
                <select className="field-select" value={issue.assigneeId ?? ''} onChange={(e) => patch.mutate({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Unassigned</option>
                  {members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {canEdit && issue.assigneeId !== me.id && <button type="button" className="link-btn" onClick={() => patch.mutate({ assigneeId: me.id })}>Assign to me</button>}
              </label>
              <label className="form-field"><span>Priority</span>
                <select className="field-select" value={issue.priority} onChange={(e) => patch.mutate({ priority: e.target.value as Priority })}>
                  {PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Type</span>
                <select className="field-select" value={issue.type} onChange={(e) => patch.mutate({ type: e.target.value as IssueType })}>
                  {[...new Set([...(m.types as IssueType[]), issue.type])].filter((t) => (t === 'subtask') === (issue.type === 'subtask')).map((t) => <option key={t} value={t} disabled={!(m.types as IssueType[]).includes(t)}>{typeLabel(m, t)}</option>)}
                </select>
              </label>
              {project && project.phases.length > 0 && issue.type !== 'epic' && (
                <label className="form-field"><span>{term(m.id, 'phase')}</span>
                  <select className="field-select" value={issue.phaseId ?? ''} onChange={(e) => patch.mutate({ phaseId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">None</option>
                    {project.phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}{ph.state === 'complete' ? ' ✓' : ''}</option>)}
                  </select>
                </label>
              )}
              {project && m.features.sprints && issue.type !== 'epic' && (
                <label className="form-field"><span>{term(m.id, 'sprint')}</span>
                  <select className="field-select" value={issue.sprintId ?? ''} onChange={(e) => patch.mutate({ sprintId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Backlog</option>
                    {project.sprints.filter((s) => s.state !== 'closed' || s.id === issue.sprintId).map((s) => <option key={s.id} value={s.id} disabled={s.state === 'closed'}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {issue.type !== 'epic' && issue.type !== 'subtask' && (
                <label className="form-field"><span>{typeLabel(m, 'epic')}</span>
                  <select className="field-select" value={issue.epicId ?? ''} onChange={(e) => patch.mutate({ epicId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">None</option>
                    {epics.map((ep) => <option key={ep.id} value={ep.id}>{ep.title}</option>)}
                  </select>
                </label>
              )}
              {/* Stacked: the side panel is too narrow for two date pickers side by side. */}
              <div>
                <label className="form-field"><span>Start</span><input className="text-input" type="date" value={issue.startDate ?? ''} max={issue.dueDate ?? undefined} onChange={(e) => patch.mutate({ startDate: e.target.value || null })} /></label>
                <label className="form-field"><span>Due</span><input className={`text-input ${overdue ? 'is-overdue' : ''}`} type="date" value={issue.dueDate ?? ''} min={issue.startDate ?? undefined} onChange={(e) => patch.mutate({ dueDate: e.target.value || null })} /></label>
              </div>
              <label className="form-field"><span>{estimateLabel(m)}</span>
                <input className="text-input" inputMode="numeric" defaultValue={issue.storyPoints ?? ''} key={issue.storyPoints ?? 'none'} placeholder="—"
                  onBlur={(e) => { const v = e.target.value.trim() === '' ? null : Math.min(999, Number(e.target.value.replace(/\D/g, ''))); if (v !== issue.storyPoints) patch.mutate({ storyPoints: v }); }} />
              </label>
              <Labels labels={issue.labels} onChange={(labels) => patch.mutate({ labels })} canEdit={canEdit} />
            </fieldset>
            <CustomFields issue={issue} fields={project?.fields ?? []} canEdit={canEdit} />
            <div className="aside-meta">
              <div><span>Reporter</span><span className="row-8"><Avatar user={member(issue.reporterId)} size="sm" />{member(issue.reporterId)?.name ?? 'Former member'}</span></div>
              <div><span>Created</span><span>{fmtDate(issue.createdAt.slice(0, 10), locale, true)}</span></div>
              <div><span>Updated</span><span>{timeAgo(issue.updatedAt, locale)}</span></div>
              {issue.resolvedAt && <div><span>Resolved</span><span>{fmtDate(issue.resolvedAt.slice(0, 10), locale, true)}</span></div>}
            </div>
          </aside>
        </div>
      </div>
      <div className="modal-footer between">
        {canEdit ? <button className="btn btn-danger" onClick={async () => (await askConfirm({ title: `Delete ${issue.key}?`, body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) && deleteIssue.mutate()}><Icon name="trash" size={14} /> Delete</button> : <span />}
        <button className="btn btn-light" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function MiniRow({ issue, onOpen }: { issue: IssueDetail['subtasks'][number]; onOpen: () => void }) {
  const { member } = useWs();
  return (
    <button className="mini-row" onClick={onOpen}>
      <TypeIcon type={issue.type} size={12} />
      <span className="issue-id">{issue.key}</span>
      <span className={`ellipsis ${issue.statusCategory === 'done' ? 'struck' : ''}`} style={{ flex: 1 }}>{issue.title}</span>
      <StatusPill name={issue.statusName} category={issue.statusCategory} />
      <Avatar user={member(issue.assigneeId)} size="sm" />
    </button>
  );
}

function Checklist({ issue, canEdit, onAdd, onToggle, onRemove }: { issue: IssueDetail; canEdit: boolean; onAdd: (t: string) => void; onToggle: (id: number, d: boolean) => void; onRemove: (id: number) => void }) {
  const [text, setText] = useState('');
  const done = issue.checklist.filter((c) => c.done).length;
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText(''); } };
  return (
    <div className="detail-section">
      <h4>Checklist {issue.checklist.length > 0 && <span className="muted-inline">· {done}/{issue.checklist.length}</span>}</h4>
      {issue.checklist.length > 0 && <div className="dist-track" style={{ marginBottom: 6 }}><div className="dist-fill" style={{ width: `${(done / issue.checklist.length) * 100}%`, background: 'var(--accent)' }} /></div>}
      {issue.checklist.map((c) => (
        <div className="check-row hoverable" key={c.id}>
          <input type="checkbox" checked={c.done} disabled={!canEdit} onChange={(e) => onToggle(c.id, e.target.checked)} id={`chk-${c.id}`} />
          <label htmlFor={`chk-${c.id}`} className={c.done ? 'struck' : ''} style={{ flex: 1 }}>{c.text}</label>
          {canEdit && <button className="icon-btn tiny reveal" onClick={() => onRemove(c.id)} aria-label={`Remove ${c.text}`}><Icon name="close" size={12} /></button>}
        </div>
      ))}
      {canEdit && (
        <form onSubmit={submit} className="row-8" style={{ marginTop: 10 }}>
          <input className="text-input" style={{ height: 35 }} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add checklist item…" aria-label="New checklist item" />
          <button className="btn btn-soft btn-sm" type="submit">Add</button>
        </form>
      )}
    </div>
  );
}

const LINK_LABEL = { blocks: ['blocks', 'is blocked by'], relates: ['relates to', 'relates to'], duplicates: ['duplicates', 'is duplicated by'] } as const;

function Links({ issue, canEdit, onOpen, onAdd, onRemove }: { issue: IssueDetail; canEdit: boolean; onOpen: (k: string) => void; onAdd: (t: string, k: string) => Promise<unknown>; onRemove: (id: number) => void }) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('relates');
  if (!issue.links.length && !canEdit) return null;
  return (
    <div className="detail-section">
      <div className="row-between"><h4>Linked work</h4>{canEdit && !adding && <button className="link-btn" onClick={() => setAdding(true)}><Icon name="link" size={13} /> Link work item</button>}</div>
      {issue.links.map((l) => (
        <div className="link-row" key={l.id}>
          <span className={`link-kind ${l.kind === 'blocks' && l.direction === 'inward' ? 'blocked' : ''}`}>{LINK_LABEL[l.kind][l.direction === 'outward' ? 0 : 1]}</span>
          <button className="mini-row" onClick={() => onOpen(l.issue.key)}>
            <TypeIcon type={l.issue.type} size={12} /><span className="issue-id">{l.issue.key}</span><span className="ellipsis" style={{ flex: 1 }}>{l.issue.title}</span>
            <StatusPill name={l.issue.statusName} category={l.issue.statusCategory} />
          </button>
          {canEdit && <button className="icon-btn tiny" onClick={() => onRemove(l.id)} aria-label="Remove link"><Icon name="close" size={12} /></button>}
        </div>
      ))}
      {adding && (
        <form className="row-8 wrap" style={{ marginTop: 8 }} onSubmit={(e) => {
          e.preventDefault();
          // Keep the form open on failure (unknown key, linking to itself) so it can be corrected.
          if (target.trim()) onAdd(target.trim().toUpperCase(), kind).then(() => { setTarget(''); setAdding(false); }, () => undefined);
        }}>
          <select className="field-select" style={{ width: 150 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Link type">
            <option value="relates">relates to</option><option value="blocks">blocks</option><option value="is_blocked_by">is blocked by</option><option value="duplicates">duplicates</option>
          </select>
          <input className="text-input" style={{ flex: 1, minWidth: 120 }} autoFocus value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Key, e.g. WEB-104" aria-label="Work item key" />
          <button className="btn btn-soft btn-sm">Link</button><button type="button" className="btn btn-light btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}

function Comments({ issue, canEdit, onPost, onEdit, onDelete }: { issue: IssueDetail; canEdit: boolean; onPost: (b: string) => Promise<unknown>; onEdit: (id: number, b: string) => void; onDelete: (id: number) => void }) {
  const { me, members, isAdmin, locale } = useWs();
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const mention = body.match(/@(\w*)$/)?.[1];
  const suggestions = mention !== undefined ? members.filter((m) => m.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5) : [];
  const [active, setActive] = useState(0);
  const pick = (m: (typeof members)[number]) => { setBody(body.replace(/@\w*$/, `@${m.name.split(' ')[0]} `)); setActive(0); };
  /** Arrow keys move through @mention suggestions; Enter or Tab picks one. */
  function onMentionKey(e: KeyboardEvent) {
    if (!suggestions.length) return false;
    const i = Math.min(active, suggestions.length - 1);
    if (e.key === 'ArrowDown') setActive((i + 1) % suggestions.length);
    else if (e.key === 'ArrowUp') setActive((i - 1 + suggestions.length) % suggestions.length);
    else if (e.key === 'Enter' || e.key === 'Tab') pick(suggestions[i]);
    else if (e.key === 'Escape') setBody(`${body} `);
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await onPost(body.trim()).then(() => setBody('')).catch(() => undefined);
  }
  return (
    <div>
      {issue.comments.map((c) => (
        <div className="comment" key={c.id}>
          {!c.author && c.body.startsWith('🤖') ? <span className="avatar bot-avatar" aria-hidden="true"><Icon name="zap" size={14} /></span> : <Avatar user={c.author} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{c.author?.name ?? (c.body.startsWith('🤖') ? 'Automation' : 'Former member')}</b> <span className="tiny-note">{timeAgo(c.createdAt, locale)}{c.editedAt ? ' · edited' : ''}</span>
            {editing?.id === c.id ? (
              <form onSubmit={(e) => { e.preventDefault(); onEdit(c.id, editing.body); setEditing(null); }} className="stack-8" style={{ marginTop: 6 }}>
                <textarea className="text-input field-textarea" style={{ minHeight: 70 }} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} autoFocus />
                <div className="row-8"><button className="btn btn-primary btn-sm">Save</button><button type="button" className="btn btn-light btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
              </form>
            ) : <p><Mentions text={c.body} /></p>}
            {editing?.id !== c.id && (c.authorId === me.id || isAdmin) && (
              <div className="comment-actions">
                {c.authorId === me.id && <button className="link-btn" onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</button>}
                <button className="link-btn" onClick={async () => (await askConfirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) && onDelete(c.id)}>Delete</button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!issue.comments.length && <p className="placeholder small">No comments yet. Start the conversation — type @ to mention someone.</p>}
      {canEdit && (
        <form onSubmit={submit} className="comment-form">
          <Avatar user={me} />
          <div style={{ flex: 1, position: 'relative' }}>
            <textarea className="text-input" rows={2} maxLength={5000} value={body} onChange={(e) => { setBody(e.target.value); setActive(0); }} placeholder="Write a comment… use @ to mention" aria-label="Write a comment"
              aria-autocomplete="list" aria-expanded={suggestions.length > 0}
              onKeyDown={(e) => { if (onMentionKey(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
            {suggestions.length > 0 && (
              <div className="mention-menu" role="listbox">
                {suggestions.map((m, i) => <button type="button" key={m.id} role="option" aria-selected={i === Math.min(active, suggestions.length - 1)} className={i === Math.min(active, suggestions.length - 1) ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}><Avatar user={m} size="sm" /> {m.name}</button>)}
              </div>
            )}
            <div className="row-between" style={{ marginTop: 6 }}><span className="tiny-note">⌘/Ctrl + Enter to send</span><button className="btn btn-primary btn-sm" disabled={!body.trim()}><Icon name="send" size={13} /> Comment</button></div>
          </div>
        </form>
      )}
    </div>
  );
}

function Mentions({ text }: { text: string }) {
  return <>{text.split(/(@\w+)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="mention">{part}</span> : part))}</>;
}

const FIELD_LABEL: Record<string, string> = { statusId: 'status', assigneeId: 'assignee', sprintId: 'sprint', epicId: 'epic', parentId: 'parent', storyPoints: 'story points', startDate: 'start date', dueDate: 'due date', type: 'type', priority: 'priority', title: 'title', description: 'description', labels: 'labels' };

function History({ activity }: { activity: Activity[] }) {
  const { member, locale } = useWs();
  if (!activity.length) return <p className="placeholder small">No history yet.</p>;
  return (
    <ul className="history">
      {activity.map((a) => {
        const who = member(a.actorId)?.name ?? (a.verb === 'automation' || a.actorId == null ? 'Automation' : 'Someone');
        const d = a.data as { field?: string; from?: unknown; to?: unknown; kind?: string; target?: string; excerpt?: string; name?: string };
        const val = (v: unknown) => (v == null || v === '' ? 'none' : Array.isArray(v) ? v.join(', ') || 'none' : String(v));
        let text: string;
        if (a.verb === 'created') text = 'created this work item';
        else if (a.verb === 'commented') text = `commented: “${d.excerpt}”`;
        else if (a.verb === 'linked') text = `linked ${d.target} (${String(d.kind).replace(/_/g, ' ')})`;
        else if (d.field === 'description') text = 'updated the description';
        else if (a.verb === 'attached') text = `attached ${d.name}`;
        else if (a.verb === 'detached') text = `removed the file ${d.name}`;
        else if (a.verb === 'automation') text = `ran the automation “${d.name}”`;
        else if (d.field === 'custom') text = `changed ${d.name} from ${val(d.from)} to ${val(d.to)}`;
        else text = `changed ${FIELD_LABEL[d.field ?? ''] ?? d.field} from ${val(d.from)} to ${val(d.to)}`;
        return <li key={a.id}><span className="history-dot" /><span><b>{who}</b> {text}</span><small>{timeAgo(a.createdAt, locale)}</small></li>;
      })}
    </ul>
  );
}

function Labels({ labels, onChange, canEdit }: { labels: string[]; onChange: (l: string[]) => void; canEdit: boolean }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !labels.includes(v)) onChange([...labels, v]); setDraft(''); };
  return (
    <div className="form-field">
      <span>Labels</span>
      <div className="label-editor">
        {labels.map((l) => <span className="task-tag removable" key={l}>{l}{canEdit && <button type="button" onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`Remove label ${l}`}><Icon name="close" size={9} /></button>}</span>)}
        {canEdit && <input value={draft} maxLength={30} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} placeholder={labels.length ? '+' : 'Add label'} aria-label="Add label" />}
      </div>
    </div>
  );
}
