import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { invalidateWork, useIssues, useProject } from '../../lib/queries';
import { useWs, useCurrentProject } from '../../lib/workspace';
import { toast, type CreateDraft } from '../../lib/store';
import { PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL, addDays, todayISO } from '../../lib/format';
import type { Issue, IssueType, Priority } from '../../lib/types';

export function CreateIssueModal({ draft, routeKey, onClose }: { draft: CreateDraft; routeKey?: string; onClose: () => void }) {
  const { projects, members, me, base, canEdit } = useWs();
  const current = useCurrentProject(routeKey);
  const [projectId, setProjectId] = useState<number | undefined>(draft.projectId ?? current?.id);
  const project = useProject(projectId);
  const issues = useIssues(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = () => ({
    title: draft.title ?? '', description: '', type: (draft.type ?? 'task') as IssueType, priority: 'medium' as Priority,
    statusId: draft.statusId ?? 0, assigneeId: '' as number | '', sprintId: draft.sprintId === undefined ? ('auto' as number | '' | 'auto') : (draft.sprintId ?? ''),
    epicId: (draft.epicId ?? '') as number | '', parentId: (draft.parentId ?? '') as number | '', storyPoints: '', startDate: '', dueDate: draft.dueDate ?? '', labels: '',
  });
  const [form, setForm] = useState(blank);

  if (!canEdit) {
    return <Modal title="View-only access" onClose={onClose}><div className="modal-body"><p className="page-subtitle" style={{ marginTop: 0 }}>Viewers can see everything but can’t create work. Ask a workspace admin for member access — it’s free.</p></div></Modal>;
  }
  if (!projects.length) {
    return <Modal title="Create a project first" onClose={onClose}><div className="modal-body"><p className="page-subtitle" style={{ marginTop: 0 }}>Work items live inside projects. Create one from the sidebar, then come back.</p></div></Modal>;
  }

  const p = project.data;
  const activeSprint = p?.sprints.find((s) => s.state === 'active');
  const epics = (issues.data ?? []).filter((i) => i.type === 'epic');
  const parents = (issues.data ?? []).filter((i) => i.type !== 'subtask' && i.type !== 'epic');
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !p) return;
    if (form.type === 'subtask' && !form.parentId) return setError('Choose the parent work item for this sub-task.');
    setBusy(true);
    setError('');
    try {
      const sprintId = form.sprintId === 'auto' ? (p.template === 'scrum' && form.type !== 'epic' ? activeSprint?.id ?? null : null) : form.sprintId || null;
      const created = await api.post<Issue>(`/projects/${p.id}/issues`, {
        title: form.title.trim(), description: form.description, type: form.type, priority: form.priority,
        statusId: form.statusId || undefined, assigneeId: form.assigneeId || null, sprintId, epicId: form.epicId || null, parentId: form.parentId || null,
        storyPoints: form.storyPoints === '' ? null : Number(form.storyPoints), startDate: form.startDate || null, dueDate: form.dueDate || null,
        labels: form.labels.split(',').map((l) => l.trim()).filter(Boolean),
      });
      invalidateWork(qc);
      toast(`${created.key} created.`, { action: { label: 'Open', run: () => navigate(`${base}/p/${p.key}/board?issue=${created.key}`) } });
      if (another) {
        setForm({ ...blank(), type: form.type, statusId: form.statusId, sprintId: form.sprintId, epicId: form.epicId, assigneeId: form.assigneeId });
        setBusy(false);
      } else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the work item.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Create a work item" subtitle={p ? `${p.name} · Keep things simple and move forward` : 'Loading project…'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {error && <div className="form-error" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
          <div className="form-grid">
            <label className="form-field">
              <span>Project</span>
              <select className="field-select" value={projectId} onChange={(e) => { setProjectId(Number(e.target.value)); setForm((f) => ({ ...f, statusId: 0, epicId: '', parentId: '', sprintId: 'auto' })); }}>
                {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name} ({pr.key})</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Type</span>
              <select className="field-select" value={form.type} onChange={(e) => set('type', e.target.value as IssueType)}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="form-field full"><span>Title *</span>
              <input className="text-input" data-autofocus value={form.title} required maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="What needs to get done?" />
            </label>
            <label className="form-field full"><span>Description</span>
              <textarea className="text-input field-textarea" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Add context, requirements or acceptance criteria…" />
            </label>
            {form.type === 'subtask' && (
              <label className="form-field full"><span>Parent work item *</span>
                <select className="field-select" value={form.parentId} onChange={(e) => set('parentId', e.target.value ? Number(e.target.value) : '')} required>
                  <option value="">Choose…</option>
                  {parents.map((i) => <option key={i.id} value={i.id}>{i.key} · {i.title}</option>)}
                </select>
              </label>
            )}
            <label className="form-field"><span>Status</span>
              <select className="field-select" value={form.statusId || p?.statuses[0]?.id || ''} onChange={(e) => set('statusId', Number(e.target.value))}>
                {p?.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="form-field"><span>Priority</span>
              <select className="field-select" value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                {PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
              </select>
            </label>
            <label className="form-field"><span>Assignee</span>
              <div className="row-8">
                <select className="field-select" value={form.assigneeId} onChange={(e) => set('assigneeId', e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Unassigned</option>
                  {members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>)}
                </select>
                {form.assigneeId !== me.id && <button type="button" className="btn btn-soft btn-sm nowrap" onClick={() => set('assigneeId', me.id)}>Me</button>}
              </div>
            </label>
            <label className="form-field"><span>Due date</span>
              <input className="text-input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
              <span className="quick-dates">
                {[['Today', 0], ['Tomorrow', 1], ['Next week', 7]].map(([l, n]) => <button type="button" key={l} className="link-btn" onClick={() => set('dueDate', addDays(todayISO(), n as number))}>{l}</button>)}
              </span>
            </label>
            {p?.template === 'scrum' && form.type !== 'epic' && (
              <label className="form-field"><span>Sprint</span>
                <select className="field-select" value={form.sprintId === 'auto' ? activeSprint?.id ?? '' : form.sprintId} onChange={(e) => set('sprintId', e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Backlog</option>
                  {p.sprints.filter((s) => s.state !== 'closed').map((s) => <option key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</option>)}
                </select>
              </label>
            )}
            {form.type !== 'epic' && epics.length > 0 && (
              <label className="form-field"><span>Epic</span>
                <select className="field-select" value={form.epicId} onChange={(e) => set('epicId', e.target.value ? Number(e.target.value) : '')}>
                  <option value="">None</option>
                  {epics.map((ep) => <option key={ep.id} value={ep.id}>{ep.title}</option>)}
                </select>
              </label>
            )}
            <label className="form-field"><span>Start date</span><input className="text-input" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
            <label className="form-field"><span>Story points</span><input className="text-input" inputMode="numeric" value={form.storyPoints} onChange={(e) => set('storyPoints', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Optional" /></label>
            <label className="form-field full"><span>Labels</span><input className="text-input" value={form.labels} onChange={(e) => set('labels', e.target.value)} placeholder="Comma separated, e.g. Design, Mobile" /></label>
          </div>
        </div>
        <div className="modal-footer between">
          <label className="check-row" style={{ margin: 0 }}><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Create another</label>
          <div className="row-8">
            <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !form.title.trim() || !p}><Icon name="check" size={15} /> {busy ? 'Creating…' : 'Create task'}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
