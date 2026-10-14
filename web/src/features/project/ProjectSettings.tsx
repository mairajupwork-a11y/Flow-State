import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast } from '../../lib/store';
import type { Status, StatusCategory } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

const COLORS = ['#7770e7', '#30adab', '#f09d75', '#9e8bb6', '#e5789a', '#5b9be0', '#d6a347', '#4fb38a'];
const CATEGORY_LABEL: Record<StatusCategory, string> = { todo: 'To do', progress: 'In progress', done: 'Done' };
const STATUS_COLORS = ['#9698ab', '#6a8ee9', '#edaf5b', '#28b391', '#8278f4', '#e5789a', '#30adab'];

export default function ProjectSettings() {
  const { project, issues } = useProjectCtx();
  const { canEdit, isAdmin, members, base } = useWs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => { invalidateWork(qc); qc.invalidateQueries({ queryKey: ['ws'] }); };
  const [details, setDetails] = useState({ name: project.name, description: project.description, color: project.color, leadId: project.leadId });
  useEffect(() => setDetails({ name: project.name, description: project.description, color: project.color, leadId: project.leadId }), [project]);

  const save = useMutation({ mutationFn: (body: object) => api.patch(`/projects/${project.id}`, body), onSuccess: () => { refresh(); toast('Project updated.'); } });
  const addStatus = useMutation({ mutationFn: (body: object) => api.post(`/projects/${project.id}/statuses`, body), onSuccess: () => { refresh(); toast('Column added.'); } });
  const editStatus = useMutation({ mutationFn: ({ id, body }: { id: number; body: object }) => api.patch(`/projects/${project.id}/statuses/${id}`, body), onSuccess: refresh });
  const removeStatus = useMutation({ mutationFn: ({ id, moveTo }: { id: number; moveTo?: number }) => api.del(`/projects/${project.id}/statuses/${id}`, { moveTo }), onSuccess: () => { refresh(); toast('Column removed. Its work was moved.'); } });
  const destroy = useMutation({ mutationFn: () => api.del(`/projects/${project.id}`), onSuccess: () => { refresh(); navigate(base, { replace: true }); toast(`${project.name} was deleted.`); } });
  const archive = useMutation({ mutationFn: () => api.patch(`/projects/${project.id}`, { archived: true }), onSuccess: () => { refresh(); navigate(base, { replace: true }); toast(`${project.name} archived.`); } });

  const [newCol, setNewCol] = useState({ name: '', category: 'progress' as StatusCategory });
  const submitDetails = (e: FormEvent) => { e.preventDefault(); save.mutate(details); };
  const submitCol = (e: FormEvent) => {
    e.preventDefault();
    if (!newCol.name.trim()) return;
    addStatus.mutate({ ...newCol, name: newCol.name.trim(), color: STATUS_COLORS[project.statuses.length % STATUS_COLORS.length] });
    setNewCol({ name: '', category: 'progress' });
  };

  return (
    <>
      <SectionBar title="Project settings" sub={`${project.key} · ${project.template} template`} />
      <div className="two-col">
        <form className="content-card" onSubmit={submitDetails}>
          <h3>Details</h3>
          <p className="muted">How this project appears to everyone</p>
          <fieldset disabled={!canEdit} className="plain stack-14" style={{ marginTop: 16 }}>
            <label className="form-field"><span>Name</span><input className="text-input" value={details.name} maxLength={80} onChange={(e) => setDetails({ ...details, name: e.target.value })} required /></label>
            <label className="form-field"><span>Description</span><textarea className="text-input field-textarea" value={details.description} maxLength={500} onChange={(e) => setDetails({ ...details, description: e.target.value })} placeholder="What is this project about?" /></label>
            <label className="form-field"><span>Project lead</span>
              <select className="field-select" value={details.leadId ?? ''} onChange={(e) => setDetails({ ...details, leadId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No lead</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <div className="form-field"><span>Colour</span>
              <div className="swatches" role="radiogroup" aria-label="Project colour">
                {COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={details.color === c} aria-label={c} className={`swatch ${details.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setDetails({ ...details, color: c })} />)}
              </div>
            </div>
            {canEdit && <div><button className="btn btn-primary" disabled={save.isPending}>Save changes</button></div>}
          </fieldset>
        </form>

        <div className="content-card">
          <h3>Workflow columns</h3>
          <p className="muted">Rename, reorder and set WIP limits. Each column belongs to a category so reports stay accurate.</p>
          <div className="workflow-list">
            {project.statuses.map((s, idx) => (
              <StatusRow key={s.id} status={s} index={idx} total={project.statuses.length} count={issues.filter((i) => i.statusId === s.id).length} canEdit={canEdit}
                others={project.statuses.filter((o) => o.id !== s.id)}
                onSave={(body) => editStatus.mutate({ id: s.id, body })} onRemove={(moveTo) => removeStatus.mutate({ id: s.id, moveTo })} />
            ))}
          </div>
          {canEdit && (
            <form className="row-8 wrap" onSubmit={submitCol} style={{ marginTop: 14 }}>
              <input className="text-input" style={{ flex: '1 1 160px' }} value={newCol.name} maxLength={40} onChange={(e) => setNewCol({ ...newCol, name: e.target.value })} placeholder="New column, e.g. QA" aria-label="New column name" />
              <select className="field-select" style={{ width: 140 }} value={newCol.category} onChange={(e) => setNewCol({ ...newCol, category: e.target.value as StatusCategory })} aria-label="Column category">
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn btn-soft" disabled={addStatus.isPending}><Icon name="plus" size={14} /> Add column</button>
            </form>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="content-card danger-zone" style={{ marginTop: 16 }}>
          <h3>Housekeeping</h3>
          <div className="setting-row">
            <div><strong>Archive project</strong><small>Hide it from the sidebar. Work is kept and can be restored by an admin.</small></div>
            <button className="btn btn-light" onClick={() => confirm(`Archive ${project.name}?`) && archive.mutate()}>Archive</button>
          </div>
          <div className="setting-row">
            <div><strong>Delete project</strong><small>Permanently removes {project.name} and all {issues.length} work items. This cannot be undone.</small></div>
            <button className="btn btn-danger" onClick={() => prompt(`Type ${project.key} to permanently delete this project.`)?.trim().toUpperCase() === project.key && destroy.mutate()}>Delete project</button>
          </div>
        </div>
      )}
    </>
  );
}

function StatusRow({ status, index, total, count, canEdit, others, onSave, onRemove }: {
  status: Status; index: number; total: number; count: number; canEdit: boolean; others: Status[]; onSave: (b: object) => void; onRemove: (moveTo?: number) => void;
}) {
  const [name, setName] = useState(status.name);
  const [wip, setWip] = useState(status.wipLimit?.toString() ?? '');
  useEffect(() => { setName(status.name); setWip(status.wipLimit?.toString() ?? ''); }, [status]);
  const commitName = () => name.trim() && name.trim() !== status.name ? onSave({ name: name.trim() }) : setName(status.name);
  const commitWip = () => {
    const v = wip.trim() ? Math.max(1, Number(wip)) : null;
    if (v !== status.wipLimit && (v === null || Number.isFinite(v))) onSave({ wipLimit: v });
  };
  return (
    <div className="workflow-row">
      <div className="reorder">
        <button className="icon-btn tiny" disabled={!canEdit || index === 0} onClick={() => onSave({ position: index - 1 })} aria-label={`Move ${status.name} left`}><Icon name="up" size={13} /></button>
        <button className="icon-btn tiny" disabled={!canEdit || index === total - 1} onClick={() => onSave({ position: index + 1 })} aria-label={`Move ${status.name} right`}><Icon name="chevron" size={13} /></button>
      </div>
      <label className="color-dot" style={{ background: status.color }} title="Change colour">
        <input type="color" value={status.color} disabled={!canEdit} onChange={(e) => onSave({ color: e.target.value })} aria-label={`${status.name} colour`} />
      </label>
      <input className="text-input slim" value={name} disabled={!canEdit} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Column name" />
      <select className="field-select slim" value={status.category} disabled={!canEdit} onChange={(e) => onSave({ category: e.target.value })} aria-label="Category">
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input className="text-input slim wip" inputMode="numeric" value={wip} disabled={!canEdit} placeholder="WIP" onChange={(e) => setWip(e.target.value.replace(/\D/g, ''))} onBlur={commitWip} aria-label="WIP limit" title="Work-in-progress limit (blank for none)" />
      <span className="col-count" title="Work items">{count}</span>
      {canEdit && (
        <button className="icon-btn tiny" disabled={total <= 1} aria-label={`Delete ${status.name}`} onClick={() => {
          if (!count) return confirm(`Delete the ${status.name} column?`) && onRemove();
          const target = others.find((o) => o.category === status.category) ?? others[0];
          if (confirm(`${count} work item${count === 1 ? '' : 's'} will move to “${target.name}”. Delete ${status.name}?`)) onRemove(target.id);
        }}><Icon name="trash" size={14} /></button>
      )}
    </div>
  );
}
