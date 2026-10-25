import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { askConfirm, toast } from '../../lib/store';
import { PRIORITIES, PRIORITY_LABEL, timeAgo } from '../../lib/format';
import { methodologyOf, typeLabel } from '../../lib/methodology';
import type { ActionKind, Automation, AutomationAction, AutomationWhen, CustomField, FieldType, IssueType, Priority, ProjectDetail, TriggerEvent } from '../../lib/types';

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown', multiselect: 'Multi-select', checkbox: 'Checkbox', url: 'Link', person: 'Person',
};

/** Extra fields every work item in the project gets (e.g. Environment, Cost, Reviewer). */
export function CustomFieldsCard({ project }: { project: ProjectDetail }) {
  const { canEdit } = useWs();
  const qc = useQueryClient();
  const refresh = () => invalidateWork(qc);
  const [draft, setDraft] = useState({ name: '', type: 'text' as FieldType, options: '' });
  const needsOptions = draft.type === 'select' || draft.type === 'multiselect';
  const add = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/fields`, { name: draft.name.trim(), type: draft.type, options: needsOptions ? splitOptions(draft.options) : [] }),
    onSuccess: () => { refresh(); toast(`Field “${draft.name.trim()}” added to every work item.`); setDraft({ name: '', type: 'text', options: '' }); },
  });
  const edit = useMutation({ mutationFn: ({ id, body }: { id: number; body: object }) => api.patch(`/projects/${project.id}/fields/${id}`, body), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/projects/${project.id}/fields/${id}`), onSuccess: () => { refresh(); toast('Field removed.'); } });
  const submit = (e: FormEvent) => { e.preventDefault(); if (draft.name.trim()) add.mutate(); };

  return (
    <div className="content-card">
      <h3><Icon name="sliders" size={16} /> Custom fields</h3>
      <p className="muted">Track anything your team needs on every work item — environment, budget, client, reviewer and more.</p>
      <div className="field-list">
        {project.fields.map((f, idx) => (
          <FieldRow key={f.id} field={f} canEdit={canEdit} first={idx === 0} last={idx === project.fields.length - 1}
            onSave={(body) => edit.mutate({ id: f.id, body })} onMove={(d) => edit.mutate({ id: f.id, body: { position: Math.max(0, idx + d) } })}
            onRemove={async () => (await askConfirm({ title: `Remove the “${f.name}” field?`, body: 'Its values are deleted from every work item.', confirmLabel: 'Remove field', danger: true })) && remove.mutate(f.id)} />
        ))}
        {!project.fields.length && <p className="placeholder small">No custom fields yet.</p>}
      </div>
      {canEdit && (
        <form className="stack-8" onSubmit={submit} style={{ marginTop: 14 }}>
          <div className="row-8 wrap">
            <input className="text-input" style={{ flex: '1 1 160px' }} maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Field name, e.g. Environment" aria-label="Field name" />
            <select className="field-select" style={{ width: 150 }} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })} aria-label="Field type">
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="btn btn-soft" disabled={add.isPending || !draft.name.trim() || (needsOptions && !splitOptions(draft.options).length)}><Icon name="plus" size={14} /> Add field</button>
          </div>
          {needsOptions && <input className="text-input" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} placeholder="Options, separated by commas — e.g. Staging, Production" aria-label="Options" />}
        </form>
      )}
    </div>
  );
}

const splitOptions = (s: string) => [...new Set(s.split(',').map((o) => o.trim()).filter(Boolean))];

function FieldRow({ field, canEdit, first, last, onSave, onMove, onRemove }: { field: CustomField; canEdit: boolean; first: boolean; last: boolean; onSave: (b: object) => void; onMove: (d: number) => void; onRemove: () => void }) {
  const [name, setName] = useState(field.name);
  const [opts, setOpts] = useState(field.options.join(', '));
  const hasOptions = field.type === 'select' || field.type === 'multiselect';
  return (
    <div className="field-row">
      <div className="reorder">
        <button className="icon-btn tiny" disabled={!canEdit || first} onClick={() => onMove(-1)} aria-label={`Move ${field.name} up`}><Icon name="up" size={13} /></button>
        <button className="icon-btn tiny" disabled={!canEdit || last} onClick={() => onMove(1)} aria-label={`Move ${field.name} down`}><Icon name="chevron" size={13} /></button>
      </div>
      <input className="text-input slim" value={name} disabled={!canEdit} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Field name"
        onBlur={() => (name.trim() && name.trim() !== field.name ? onSave({ name: name.trim() }) : setName(field.name))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="field-type-chip">{TYPE_LABEL[field.type]}</span>
      {hasOptions && (
        <input className="text-input slim field-opts" value={opts} disabled={!canEdit} onChange={(e) => setOpts(e.target.value)} aria-label={`${field.name} options`} title="Options, separated by commas"
          onBlur={() => { const next = splitOptions(opts); if (next.length && next.join('|') !== field.options.join('|')) onSave({ options: next }); else setOpts(field.options.join(', ')); }} />
      )}
      {canEdit && <button className="icon-btn tiny" onClick={onRemove} aria-label={`Remove ${field.name}`}><Icon name="trash" size={14} /></button>}
    </div>
  );
}

// ---------- Automations ----------
const TRIGGER_LABEL: Record<TriggerEvent, string> = {
  created: 'A work item is created', status: 'A work item moves to a column', assigned: 'A work item is assigned', priority: 'Priority changes',
  comment: 'Someone comments', due_soon: 'A due date is coming up', overdue: 'A work item becomes overdue',
};
const ACTION_LABEL: Record<ActionKind, string> = {
  notify: 'Notify people', assign: 'Assign to', priority: 'Set priority', label: 'Add a label', move: 'Move to column', comment: 'Post a comment', due: 'Set due date',
};

export function AutomationsCard({ project }: { project: ProjectDetail }) {
  const { canEdit, members, locale } = useWs();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['automations', project.id], queryFn: () => api.get<Automation[]>(`/projects/${project.id}/automations`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations', project.id] });
  const toggle = useMutation({ mutationFn: (a: Automation) => api.patch(`/projects/${project.id}/automations/${a.id}`, { enabled: !a.enabled }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/projects/${project.id}/automations/${id}`), onSuccess: () => { refresh(); toast('Automation deleted.'); } });
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);
  const name = (id?: number | string | null) => (id === 'reporter' ? 'the reporter' : members.find((m) => m.id === id)?.name ?? 'someone');
  const col = (id?: number) => project.statuses.find((s) => s.id === id)?.name ?? 'a column';

  const describe = (a: Automation) => {
    const w = a.when;
    const when = w.event === 'status' ? `moves to ${w.statusId ? col(w.statusId) : 'any column'}` : w.event === 'assigned' ? `is assigned${w.userId ? ` to ${name(w.userId)}` : ''}`
      : w.event === 'priority' ? `becomes ${w.priority ?? 'any'} priority` : w.event === 'created' ? 'is created' : w.event === 'comment' ? 'gets a comment'
      : w.event === 'due_soon' ? `is due within ${w.days ?? 1} day${(w.days ?? 1) === 1 ? '' : 's'}` : 'becomes overdue';
    const filt = [w.filter?.type && `${w.filter.type}s`, w.filter?.priority && `${w.filter.priority} priority`, w.filter?.label && `labelled “${w.filter.label}”`].filter(Boolean).join(', ');
    const thens = a.then.map((t) => t.action === 'notify' ? `notify ${(t.to ?? []).map((x) => (typeof x === 'number' ? name(x) : `the ${x}`)).join(', ')}`
      : t.action === 'assign' ? `assign to ${name(t.userId)}` : t.action === 'priority' ? `set ${t.priority} priority` : t.action === 'label' ? `add “${t.label}”`
      : t.action === 'move' ? `move to ${col(t.statusId)}` : t.action === 'comment' ? 'post a comment' : `due in ${t.days} day${t.days === 1 ? '' : 's'}`);
    return <>When an item{filt ? <> ({filt})</> : null} <b>{when}</b> → {thens.join(', then ')}</>;
  };

  return (
    <div className="content-card">
      <div className="row-between wrap" style={{ gap: 10 }}>
        <div>
          <h3><Icon name="zap" size={16} /> Automations</h3>
          <p className="muted">Let WorkMars do the routine steps: notify, assign, label, move and remind — the moment something happens.</p>
        </div>
        {canEdit && !editing && <button className="btn btn-soft btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={13} /> New automation</button>}
      </div>
      {editing && <RuleEditor project={project} initial={editing === 'new' ? null : editing} onDone={() => { setEditing(null); refresh(); }} />}
      <div className="rule-list">
        {list.data?.map((a) => (
          <div className={`rule-row ${a.enabled ? '' : 'off'}`} key={a.id}>
            <label className="switch" title={a.enabled ? 'On' : 'Off'}>
              <input type="checkbox" checked={a.enabled} disabled={!canEdit} onChange={() => toggle.mutate(a)} aria-label={`${a.name} ${a.enabled ? 'on' : 'off'}`} /><span />
            </label>
            <div className="rule-text">
              <strong>{a.name}</strong>
              <small>{describe(a)}</small>
              <small className="tiny-note">{a.runCount ? `Ran ${a.runCount} time${a.runCount === 1 ? '' : 's'}${a.lastRunAt ? ` · last ${timeAgo(a.lastRunAt.replace(' ', 'T') + 'Z', locale)}` : ''}` : 'Hasn’t run yet'}</small>
            </div>
            {canEdit && (
              <span className="row-8">
                <button className="icon-btn tiny" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}><Icon name="edit" size={14} /></button>
                <button className="icon-btn tiny" onClick={async () => (await askConfirm({ title: `Delete “${a.name}”?`, confirmLabel: 'Delete', danger: true })) && remove.mutate(a.id)} aria-label={`Delete ${a.name}`}><Icon name="trash" size={14} /></button>
              </span>
            )}
          </div>
        ))}
        {list.data && !list.data.length && !editing && (
          <div className="rule-ideas">
            <p className="placeholder small">No automations yet. Popular ones:</p>
            <ul>
              <li>When an item moves to <b>Done</b> → notify the reporter</li>
              <li>When a <b>bug</b> is created → set urgent priority and assign it</li>
              <li>When an item is due within <b>1 day</b> → remind the assignee</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function RuleEditor({ project, initial, onDone }: { project: ProjectDetail; initial: Automation | null; onDone: () => void }) {
  const { members } = useWs();
  const m = methodologyOf(project);
  const doneCol = project.statuses.find((s) => s.category === 'done');
  const [name, setName] = useState(initial?.name ?? '');
  const [when, setWhen] = useState<AutomationWhen>(initial?.when ?? { event: 'status', statusId: doneCol?.id });
  const [then, setThen] = useState<AutomationAction[]>(initial?.then ?? [{ action: 'notify', to: ['reporter'] }]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim() || autoName(when, then, project), when: clean(when), then };
      return initial ? api.patch(`/projects/${project.id}/automations/${initial.id}`, body) : api.post(`/projects/${project.id}/automations`, body);
    },
    onSuccess: () => { toast(initial ? 'Automation updated.' : 'Automation is on.'); onDone(); },
  });
  const setAction = (i: number, a: AutomationAction) => setThen(then.map((x, j) => (j === i ? a : x)));
  const people = members.filter((x) => x.role !== 'viewer');

  return (
    <form className="rule-editor" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="rule-step">
        <span className="rule-badge">When</span>
        <select className="field-select" value={when.event} onChange={(e) => setWhen({ event: e.target.value as TriggerEvent, filter: when.filter })} aria-label="Trigger">
          {Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {when.event === 'status' && (
          <select className="field-select" value={when.statusId ?? ''} onChange={(e) => setWhen({ ...when, statusId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Column">
            <option value="">Any column</option>{project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {when.event === 'assigned' && (
          <select className="field-select" value={when.userId ?? ''} onChange={(e) => setWhen({ ...when, userId: e.target.value ? Number(e.target.value) : undefined })} aria-label="Assignee">
            <option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {when.event === 'priority' && (
          <select className="field-select" value={when.priority ?? ''} onChange={(e) => setWhen({ ...when, priority: (e.target.value || undefined) as Priority | undefined })} aria-label="Priority">
            <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        )}
        {when.event === 'due_soon' && (
          <label className="row-8 inline-num">within <input className="text-input slim" type="number" min={0} max={30} value={when.days ?? 1} onChange={(e) => setWhen({ ...when, days: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} /> day(s)</label>
        )}
      </div>
      <div className="rule-step">
        <span className="rule-badge soft">Only if</span>
        <select className="field-select" value={when.filter?.type ?? ''} onChange={(e) => setWhen({ ...when, filter: { ...when.filter, type: e.target.value || undefined } })} aria-label="Only this type">
          <option value="">Any type</option>{(m.types as IssueType[]).map((t) => <option key={t} value={t}>{typeLabel(m, t)}</option>)}
        </select>
        <select className="field-select" value={when.filter?.priority ?? ''} onChange={(e) => setWhen({ ...when, filter: { ...when.filter, priority: (e.target.value || undefined) as Priority | undefined } })} aria-label="Only this priority">
          <option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <input className="text-input" style={{ maxWidth: 160 }} maxLength={30} value={when.filter?.label ?? ''} onChange={(e) => setWhen({ ...when, filter: { ...when.filter, label: e.target.value || undefined } })} placeholder="With label…" aria-label="Only with this label" />
      </div>
      {then.map((a, i) => (
        <div className="rule-step" key={i}>
          <span className="rule-badge">{i === 0 ? 'Then' : 'And'}</span>
          <select className="field-select" value={a.action} onChange={(e) => setAction(i, defaultAction(e.target.value as ActionKind, project))} aria-label="Action">
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {a.action === 'notify' && (
            <div className="chip-picker">
              {(['assignee', 'reporter', 'watchers'] as const).map((r) => {
                const on = a.to?.includes(r);
                return <button type="button" key={r} className={`chip-option ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setAction(i, { ...a, to: on ? a.to!.filter((x) => x !== r) : [...(a.to ?? []), r] })}>the {r}</button>;
              })}
              {people.map((p) => {
                const on = a.to?.includes(p.id);
                return <button type="button" key={p.id} className={`chip-option ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setAction(i, { ...a, to: on ? a.to!.filter((x) => x !== p.id) : [...(a.to ?? []), p.id] })}>{p.name}</button>;
              })}
              <input className="text-input" maxLength={200} value={a.message ?? ''} onChange={(e) => setAction(i, { ...a, message: e.target.value || undefined })} placeholder="Optional message, e.g. Ready for QA" aria-label="Message" />
            </div>
          )}
          {a.action === 'assign' && (
            <select className="field-select" value={a.userId ?? ''} onChange={(e) => setAction(i, { ...a, userId: e.target.value === 'reporter' ? 'reporter' : e.target.value ? Number(e.target.value) : null })} aria-label="Assign to">
              <option value="">Unassigned</option><option value="reporter">The reporter</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {a.action === 'priority' && (
            <select className="field-select" value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value as Priority })} aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          )}
          {a.action === 'label' && <input className="text-input" maxLength={30} value={a.label ?? ''} onChange={(e) => setAction(i, { ...a, label: e.target.value })} placeholder="Label" aria-label="Label" />}
          {a.action === 'move' && (
            <select className="field-select" value={a.statusId} onChange={(e) => setAction(i, { ...a, statusId: Number(e.target.value) })} aria-label="Column">
              {project.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {a.action === 'comment' && <input className="text-input" style={{ flex: 1 }} maxLength={1000} value={a.text ?? ''} onChange={(e) => setAction(i, { ...a, text: e.target.value })} placeholder="Comment text" aria-label="Comment" />}
          {a.action === 'due' && <label className="row-8 inline-num">in <input className="text-input slim" type="number" min={0} max={365} value={a.days ?? 0} onChange={(e) => setAction(i, { ...a, days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} /> day(s)</label>}
          {then.length > 1 && <button type="button" className="icon-btn tiny" onClick={() => setThen(then.filter((_, j) => j !== i))} aria-label="Remove this action"><Icon name="close" size={12} /></button>}
        </div>
      ))}
      {then.length < 5 && <button type="button" className="link-btn" onClick={() => setThen([...then, defaultAction('label', project)])}><Icon name="plus" size={13} /> Add another action</button>}
      <div className="rule-step">
        <span className="rule-badge soft">Name</span>
        <input className="text-input" style={{ flex: 1 }} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName(when, then, project)} aria-label="Automation name" />
      </div>
      <div className="row-8"><button className="btn btn-primary btn-sm" disabled={save.isPending}>{initial ? 'Save automation' : 'Turn on automation'}</button><button type="button" className="btn btn-light btn-sm" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function defaultAction(action: ActionKind, project: ProjectDetail): AutomationAction {
  switch (action) {
    case 'notify': return { action, to: ['assignee'] };
    case 'assign': return { action, userId: 'reporter' };
    case 'priority': return { action, priority: 'high' };
    case 'label': return { action, label: '' };
    case 'move': return { action, statusId: project.statuses[project.statuses.length - 1]?.id };
    case 'comment': return { action, text: '' };
    case 'due': return { action, days: 3 };
  }
}

function clean(w: AutomationWhen): AutomationWhen {
  const filter = Object.fromEntries(Object.entries(w.filter ?? {}).filter(([, v]) => v));
  return { ...w, filter: Object.keys(filter).length ? filter : undefined };
}

function autoName(w: AutomationWhen, then: AutomationAction[], project: ProjectDetail) {
  const col = project.statuses.find((s) => s.id === w.statusId)?.name;
  const trig = { created: 'New item', status: col ? `Moved to ${col}` : 'Column change', assigned: 'Assigned', priority: 'Priority change', comment: 'New comment', due_soon: 'Due soon', overdue: 'Overdue' }[w.event];
  return `${trig} → ${ACTION_LABEL[then[0]?.action ?? 'notify'].toLowerCase()}`;
}
