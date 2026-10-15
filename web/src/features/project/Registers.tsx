import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, ErrorState, Modal, PageLoader } from '../../components/ui';
import { FieldInput, fieldText } from '../../components/FieldInput';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { askConfirm, toast } from '../../lib/store';
import { timeAgo } from '../../lib/format';
import { REGISTERS, methodologyOf, type RegisterDef } from '../../lib/methodology';
import type { Entry, FieldValues } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

/** Probability × impact (1–25) or severity × occurrence × detection (1–1000). */
export function entryScore(def: RegisterDef, data: FieldValues): number | null {
  const n = (k: string) => Number(data[k]) || 0;
  if (def.score === 'pxi') return n('probability') && n('impact') ? n('probability') * n('impact') : null;
  if (def.score === 'rpn') return n('severity') && n('occurrence') && n('detection') ? n('severity') * n('occurrence') * n('detection') : null;
  return null;
}

/** Red / amber / green banding used on risk matrices. */
export function scoreBand(def: RegisterDef, score: number | null): 'high' | 'medium' | 'low' | 'none' {
  if (score == null) return 'none';
  if (def.score === 'pxi') return score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low';
  return score >= 200 ? 'high' : score >= 100 ? 'medium' : 'low';
}

export default function Registers() {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const { canEdit } = useWs();
  const entries = useQuery({ queryKey: ['entries', project.id], queryFn: () => api.get<Entry[]>(`/projects/${project.id}/entries`) });
  // Registers the methodology uses, plus any that still hold entries after a switch.
  const kinds = useMemo(() => [...new Set([...m.registers, ...(entries.data ?? []).map((e) => e.kind)])].filter((k) => REGISTERS[k]), [m.registers, entries.data]);
  const [tab, setTab] = useState<string | null>(null);
  const kind = tab && kinds.includes(tab) ? tab : kinds[0];
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);

  if (entries.error) return <ErrorState error={entries.error} retry={entries.refetch} />;
  if (!entries.data) return <PageLoader />;
  if (!kind) return <><SectionBar title="Registers" /><Empty icon="shield" title="No registers in this methodology">{m.name} keeps things light — there are no formal logs to maintain.</Empty></>;

  const def = REGISTERS[kind];
  const list = entries.data.filter((e) => e.kind === kind);
  const closed = def.statuses[def.statuses.length - 1];
  const open = list.filter((e) => e.status !== closed);

  return (
    <>
      <SectionBar title={kinds.length > 1 ? 'Registers & logs' : def.label} sub={`${m.name} · ${open.length} open of ${list.length}`} />
      {kinds.length > 1 && (
        <div className="register-tabs" role="tablist" aria-label="Registers">
          {kinds.map((k) => {
            const count = entries.data.filter((e) => e.kind === k && e.status !== REGISTERS[k].statuses[REGISTERS[k].statuses.length - 1]).length;
            return (
              <button key={k} role="tab" aria-selected={k === kind} className={`register-tab ${k === kind ? 'on' : ''}`} onClick={() => setTab(k)}>
                <Icon name={REGISTERS[k].icon} size={15} /> {REGISTERS[k].label}{count ? <span className="side-counter">{count}</span> : null}
                {!m.registers.includes(k) && <small className="muted"> (from a previous methodology)</small>}
              </button>
            );
          })}
        </div>
      )}

      <div className={def.score ? 'register-layout' : ''}>
        {def.score === 'pxi' && <HeatMap entries={open} def={def} onPick={setEditing} />}
        {def.score === 'rpn' && <RpnPareto entries={open} def={def} onPick={setEditing} />}
        <div className="content-card">
          <div className="row-between wrap" style={{ gap: 10 }}>
            <div><h3>{def.label}</h3><p className="muted">{REGISTER_HELP[kind]}</p></div>
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={14} /> New entry</button>}
          </div>
          <RegisterTable def={def} list={list} onOpen={setEditing} />
        </div>
      </div>

      {editing && <EntryModal def={def} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const REGISTER_HELP: Record<string, string> = {
  risk: 'Uncertain events that could affect objectives. Score probability × impact and agree a response.',
  fmea: 'Failure Mode and Effects Analysis. RPN = severity × occurrence × detection — tackle the highest first.',
  issue: 'Requests for change, off-specifications and problems escalated to the Project Board.',
  change: 'Every requested change to scope, with its time and cost impact and the decision taken.',
  lesson: 'What went well and what to improve — captured as you go, shared at every boundary.',
  quality: 'Planned quality checks on each product, who reviews it and the result.',
  waste: 'The eight wastes (DOWNTIME) spotted in the flow and the countermeasures that remove them.',
  kaizen: 'Small, continuous improvements — trialled, then standardised if they work.',
  impediment: 'Anything slowing the team down that the Scrum Master or team needs to remove.',
};

function RegisterTable({ def, list, onOpen }: { def: RegisterDef; list: Entry[]; onOpen: (e: Entry) => void }) {
  const { member, members } = useWs();
  const shown = def.fields.filter((f) => f.type === 'select' || f.type === 'number').slice(0, 2);
  const sorted = [...list].sort((a, b) => (entryScore(def, b.data) ?? -1) - (entryScore(def, a.data) ?? -1) || b.id - a.id);
  if (!list.length) return <Empty icon={def.icon} title="Nothing logged yet">Add the first entry to start the {def.label.toLowerCase()}.</Empty>;
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table className="list-table register-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            {def.score && <th scope="col">{def.score === 'pxi' ? 'Score' : 'RPN'}</th>}
            {shown.map((f) => <th key={f.key} scope="col" className="hide-narrow">{f.label}</th>)}
            <th scope="col">Status</th>
            <th scope="col">Owner</th>
            <th scope="col" className="hide-narrow">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const score = entryScore(def, e.data);
            return (
              <tr key={e.id} tabIndex={0} onClick={() => onOpen(e)} onKeyDown={(k) => k.key === 'Enter' && onOpen(e)} className="clickable">
                <td><strong>{e.title}</strong></td>
                {def.score && <td><span className={`score-chip ${scoreBand(def, score)}`}>{score ?? '—'}</span></td>}
                {shown.map((f) => <td key={f.key} className="hide-narrow">{fieldText(f, e.data[f.key], members)}</td>)}
                <td><span className={`register-status ${e.status === def.statuses[def.statuses.length - 1] ? 'closed' : e.status === def.statuses[0] ? 'new' : 'mid'}`}>{e.status}</span></td>
                <td><Avatar user={member(e.ownerId)} size="sm" /></td>
                <td className="hide-narrow muted">{timeAgo(e.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 5×5 probability/impact matrix, the standard risk heat map. */
function HeatMap({ entries, def, onPick }: { entries: Entry[]; def: RegisterDef; onPick: (e: Entry) => void }) {
  const cells = (p: number, i: number) => entries.filter((e) => Number(e.data.probability) === p && Number(e.data.impact) === i);
  return (
    <div className="content-card heatmap-card">
      <h3>Risk heat map</h3>
      <p className="muted">Open risks by probability × impact</p>
      <div className="heatmap" role="table" aria-label="Probability by impact matrix">
        {[5, 4, 3, 2, 1].map((p) => (
          <div className="heat-row" role="row" key={p}>
            <span className="heat-axis" role="rowheader">{p}</span>
            {[1, 2, 3, 4, 5].map((i) => {
              const here = cells(p, i);
              return (
                <div key={i} role="cell" className={`heat-cell ${scoreBand(def, p * i)}`} title={`Probability ${p} × impact ${i} = ${p * i}`}>
                  {here.slice(0, 3).map((e) => <button key={e.id} className="heat-dot" onClick={() => onPick(e)} title={e.title} aria-label={e.title}>{e.title.slice(0, 1)}</button>)}
                  {here.length > 3 && <small>+{here.length - 3}</small>}
                </div>
              );
            })}
          </div>
        ))}
        <div className="heat-row heat-x" aria-hidden="true"><span className="heat-axis" />{[1, 2, 3, 4, 5].map((i) => <span key={i} className="heat-axis">{i}</span>)}</div>
      </div>
      <div className="heat-legend"><span>↑ Probability</span><span>Impact →</span></div>
    </div>
  );
}

/** Failure modes ranked by risk priority number. */
function RpnPareto({ entries, def, onPick }: { entries: Entry[]; def: RegisterDef; onPick: (e: Entry) => void }) {
  const ranked = entries.map((e) => ({ e, s: entryScore(def, e.data) ?? 0 })).sort((a, b) => b.s - a.s).slice(0, 8);
  const max = Math.max(1, ...ranked.map((r) => r.s));
  return (
    <div className="content-card heatmap-card">
      <h3>RPN ranking</h3>
      <p className="muted">Highest-risk failure modes first (action threshold 200)</p>
      <div className="rpn-bars">
        {ranked.map(({ e, s }) => (
          <button key={e.id} className="rpn-row" onClick={() => onPick(e)}>
            <span className="ellipsis">{e.title}</span>
            <span className="rpn-track"><i className={scoreBand(def, s)} style={{ width: `${(s / max) * 100}%` }} /></span>
            <strong>{s}</strong>
          </button>
        ))}
        {!ranked.length && <p className="muted">No open failure modes.</p>}
      </div>
    </div>
  );
}

function EntryModal({ def, entry, onClose }: { def: RegisterDef; entry: Entry | null; onClose: () => void }) {
  const { project } = useProjectCtx();
  const { members, canEdit } = useWs();
  const qc = useQueryClient();
  const [title, setTitle] = useState(entry?.title ?? '');
  const [status, setStatus] = useState(entry?.status ?? def.statuses[0]);
  const owner = def.fields.find((f) => f.key === 'owner');
  const [data, setData] = useState<FieldValues>(() => ({ ...(owner && entry?.ownerId ? { owner: entry.ownerId } : {}), ...(entry?.data ?? {}) }));
  const refresh = () => { qc.invalidateQueries({ queryKey: ['entries', project.id] }); qc.invalidateQueries({ queryKey: ['reports'] }); };
  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), status, ownerId: owner ? (data.owner as number | null) ?? null : entry?.ownerId ?? null, data };
      return entry ? api.patch(`/projects/${project.id}/entries/${entry.id}`, body) : api.post(`/projects/${project.id}/entries`, { kind: def.kind, ...body });
    },
    onSuccess: () => { refresh(); toast(entry ? 'Entry updated.' : 'Entry added.'); onClose(); },
  });
  const remove = useMutation({ mutationFn: () => api.del(`/projects/${project.id}/entries/${entry!.id}`), onSuccess: () => { refresh(); toast('Entry deleted.'); onClose(); } });
  const score = entryScore(def, data);
  const submit = (e: FormEvent) => { e.preventDefault(); if (title.trim()) save.mutate(); };

  return (
    <Modal title={entry ? entry.title : `New ${def.label.toLowerCase().replace(/ register| log/, '')} entry`} subtitle={def.label} onClose={onClose} wide
      footer={canEdit && (
        <>
          {entry && <button className="btn btn-light" style={{ marginRight: 'auto' }} onClick={async () => (await askConfirm({ title: 'Delete this entry?', confirmLabel: 'Delete', danger: true })) && remove.mutate()}><Icon name="trash" size={14} /> Delete</button>}
          <button className="btn btn-light" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="entry-form" disabled={!title.trim() || save.isPending}>{entry ? 'Save' : 'Add entry'}</button>
        </>
      )}>
      <form id="entry-form" className="modal-body field-grid" onSubmit={submit}>
        <fieldset className="plain field-grid span-2" disabled={!canEdit}>
          <label className="form-field span-2"><span>Title</span><input className="text-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required data-autofocus /></label>
          <label className="form-field"><span>Status</span>
            <select className="field-select" value={status} onChange={(e) => setStatus(e.target.value)}>{def.statuses.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          {def.score && (
            <div className="form-field"><span>{def.score === 'pxi' ? 'Risk score (P × I)' : 'RPN (S × O × D)'}</span>
              <div className={`score-chip big ${scoreBand(def, score)}`}>{score ?? 'Set the scores below'}</div>
            </div>
          )}
          {def.fields.map((f) => <FieldInput key={f.key} field={f} value={data[f.key]} members={members} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} />)}
        </fieldset>
      </form>
    </Modal>
  );
}
