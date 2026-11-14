import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { toast } from '../../lib/store';
import type { ProjectDetail } from '../../lib/types';

type Field = 'title' | 'description' | 'type' | 'status' | 'priority' | 'assignee' | 'dueDate' | 'startDate' | 'labels' | 'storyPoints' | 'key';
type Row = Record<string, string>;
const FIELDS: [Field, string, string[]][] = [
  ['title', 'Title', ['summary', 'title', 'name', 'task name', 'card name', 'task', 'subject', 'issue', 'item']],
  ['status', 'Status / column', ['status', 'list name', 'list', 'section/column', 'section', 'column', 'state', 'stage']],
  ['assignee', 'Assignee (email or name)', ['assignee', 'assignee email', 'assigned to', 'assignees', 'owner', 'members', 'responsible']],
  ['priority', 'Priority', ['priority', 'importance', 'severity']],
  ['type', 'Type', ['issue type', 'type', 'task type', 'work item type', 'tracker', 'category']],
  ['dueDate', 'Due date', ['due date', 'due', 'deadline', 'due on', 'end date', 'target date', 'finish date']],
  ['startDate', 'Start date', ['start date', 'start', 'start on', 'begin date']],
  ['labels', 'Labels / tags', ['labels', 'tags', 'label', 'components', 'component']],
  ['storyPoints', 'Story points / estimate', ['story points', 'story point estimate', 'points', 'estimate', 'sp', 'custom field (story points)']],
  ['description', 'Description', ['description', 'desc', 'notes', 'task content', 'content', 'details', 'body']],
  ['key', 'Original key / ID', ['issue key', 'key', 'card id', 'task id', 'issue id', 'id']],
];

/** RFC 4180 CSV reader: quotes, escaped quotes, newlines in cells, BOM, and comma/semicolon/tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split('\n')[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

/** Trello board export (JSON): open cards with their list, labels, members and due date. */
function readTrello(json: { cards?: { name: string; desc?: string; idList?: string; closed?: boolean; due?: string | null; labels?: { name: string; color?: string }[]; idMembers?: string[]; idShort?: number }[]; lists?: { id: string; name: string }[]; members?: { id: string; fullName: string }[] }) {
  const lists = new Map((json.lists ?? []).map((l) => [l.id, l.name]));
  const members = new Map((json.members ?? []).map((m) => [m.id, m.fullName]));
  const head = ['Card name', 'List name', 'Members', 'Labels', 'Due date', 'Description', 'Card ID'];
  const rows = (json.cards ?? []).filter((c) => !c.closed).map((c) => [c.name, lists.get(c.idList ?? '') ?? '', (c.idMembers ?? []).map((id) => members.get(id) ?? '').filter(Boolean).join(', '),
    (c.labels ?? []).map((l) => l.name || l.color || '').filter(Boolean).join(', '), c.due ?? '', c.desc ?? '', c.idShort ? `#${c.idShort}` : '']);
  return [head, ...rows];
}

function guess(headers: string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  const lower = headers.map((h) => h.trim().toLowerCase());
  const used = new Set<number>();
  for (const [field, , names] of FIELDS) {
    let idx = -1;
    for (const n of names) { idx = lower.findIndex((h, i) => !used.has(i) && h === n); if (idx >= 0) break; }
    if (idx < 0) for (const n of names) { idx = lower.findIndex((h, i) => !used.has(i) && n.length > 3 && h.includes(n)); if (idx >= 0) break; }
    if (idx >= 0) { out[field] = headers[idx]; used.add(idx); }
  }
  return out;
}

const TEMPLATE = 'Title,Status,Assignee,Priority,Type,Due date,Labels,Story points,Description\nDesign the login page,To do,you@company.com,High,Story,2026-06-01,"design, web",3,Hero + form\n';

export function ImportModal({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[]; unmatchedPeople: string[] } | null>(null);

  async function read(file: File) {
    setError('');
    try {
      const text = await file.text();
      const t = file.name.toLowerCase().endsWith('.json') ? readTrello(JSON.parse(text)) : parseCsv(text);
      if (t.length < 2) throw new Error('That file has no rows to import.');
      setTable(t); setFileName(file.name); setMap(guess(t[0]));
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith('That') ? err.message : 'Could not read that file. Export it as CSV (or a Trello JSON export) and try again.');
    }
  }
  const headers = table?.[0] ?? [];
  const rows: Row[] = useMemo(() => (table ? table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) : []), [table, headers]);
  const mapped = rows.map((r) => Object.fromEntries(FIELDS.filter(([f]) => map[f]).map(([f]) => [f, r[map[f]!] ?? ''])) as Record<Field, string>);
  const withTitle = mapped.filter((r) => r.title?.trim()).length;
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of mapped) if (r.status) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [mapped]);

  async function run() {
    setBusy(true); setError('');
    try {
      let created = 0; const skipped: { row: number; reason: string }[] = []; const unmatched = new Set<string>();
      for (let i = 0; i < mapped.length; i += 2000) {
        const res = await api.post<{ created: number; skipped: { row: number; reason: string }[]; unmatchedPeople: string[] }>(`/projects/${project.id}/import`, { rows: mapped.slice(i, i + 2000) });
        created += res.created; skipped.push(...res.skipped.map((s) => ({ ...s, row: s.row + i }))); res.unmatchedPeople.forEach((p) => unmatched.add(p));
      }
      setResult({ created, skipped, unmatchedPeople: [...unmatched] });
      invalidateWork(qc);
      toast(`${created} work items imported into ${project.name}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed.'); }
    setBusy(false);
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) read(f); };
  return (
    <Modal wide title="Import work items" subtitle={`Into ${project.name} · from Jira, Trello, Asana, ClickUp, Excel or Google Sheets`} onClose={onClose}
      footer={result ? <button className="btn btn-primary" onClick={onClose}>Done</button>
        : table ? <><button className="btn btn-light" onClick={() => { setTable(null); setFileName(''); }}>Choose another file</button><button className="btn btn-primary" disabled={busy || !map.title || !withTitle} onClick={run}><Icon name="upload" size={14} /> {busy ? 'Importing…' : `Import ${withTitle} work item${withTitle === 1 ? '' : 's'}`}</button></>
        : <button className="btn btn-light" onClick={onClose}>Cancel</button>}>
      <div className="modal-body stack-14">
        {error && <div className="form-error" role="alert">{error}</div>}
        {result ? (
          <div className="import-result">
            <span className="import-big"><Icon name="checkcircle" size={28} /></span>
            <h3>{result.created} work item{result.created === 1 ? '' : 's'} imported</h3>
            {result.unmatchedPeople.length > 0 && <p className="muted">Not matched to anyone in the workspace (left unassigned): {result.unmatchedPeople.join(', ')}. Invite them, then assign.</p>}
            {result.skipped.length > 0 && <details><summary>{result.skipped.length} row{result.skipped.length === 1 ? '' : 's'} skipped</summary><ul>{result.skipped.slice(0, 30).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul></details>}
          </div>
        ) : !table ? (
          <>
            <div className={`import-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}>
              <Icon name="upload" size={26} />
              <b>Drop a CSV or Trello JSON file here</b>
              <span className="muted">or click to choose one</span>
              <input ref={input} type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
            </div>
            <div className="import-help">
              <div><b>Jira</b><span>Filters → View all issues → Export → <i>Export CSV (all fields)</i></span></div>
              <div><b>Trello</b><span>Board menu → More → Print and export → <i>Export as JSON</i></span></div>
              <div><b>Asana / ClickUp / Monday</b><span>Project menu → <i>Export → CSV</i></span></div>
              <div><b>Excel / Google Sheets</b><span>File → Download → <i>CSV</i>. <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="workmars-import-template.csv">Get a template</a></span></div>
            </div>
          </>
        ) : (
          <>
            <p className="import-file"><Icon name="file" size={15} /> <b>{fileName}</b> · {rows.length} rows · {headers.length} columns. We matched the columns below — change any that look wrong.</p>
            <div className="import-map">
              {FIELDS.map(([f, label]) => (
                <label key={f} className="import-field">
                  <span>{label}{f === 'title' && ' *'}</span>
                  <select className="field-select" value={map[f] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f]: e.target.value || undefined }))}>
                    <option value="">— Don’t import —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <small className="ellipsis">{map[f] ? (rows.find((r) => r[map[f]!]?.trim())?.[map[f]!] ?? '').slice(0, 60) || '(empty)' : ''}</small>
                </label>
              ))}
            </div>
            {statusCounts.length > 0 && (
              <div className="import-status">
                <b>Statuses</b> <span className="muted">— matched to this project’s columns by name or meaning (e.g. “Closed” → Done):</span>
                <div className="row-8 wrap" style={{ marginTop: 8 }}>{statusCounts.map(([s, n]) => <span key={s} className="soft-chip">{s} · {n}</span>)}</div>
              </div>
            )}
            {!map.title && <div className="form-error">Choose which column holds the title.</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
