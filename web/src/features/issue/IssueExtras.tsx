import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api, IS_DEMO } from '../../lib/api';
import { invalidateWork, keys } from '../../lib/queries';
import { askConfirm, toast, toastError } from '../../lib/store';
import { useWs } from '../../lib/workspace';
import { timeAgo } from '../../lib/format';
import type { Attachment, CustomField, CustomValue, IssueDetail } from '../../lib/types';

const MAX_MB = 10;
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(mime);
const fileIcon = (mime: string) => (mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'file' : mime.startsWith('video/') ? 'play' : 'attachment');

/** Files on a work item: drop, pick or paste to upload; images preview inline. */
export function Attachments({ issue, canEdit }: { issue: IssueDetail; canEdit: boolean }) {
  const { me, isAdmin, locale } = useWs();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);

  async function send(files: File[]) {
    const ok = files.filter((f) => {
      if (f.size > MAX_MB * 1024 * 1024) { toastError(new Error(`${f.name} is larger than ${MAX_MB} MB.`)); return false; }
      if (!f.size) { toastError(new Error(`${f.name} is empty.`)); return false; }
      return true;
    });
    if (!ok.length) return;
    setUploading((u) => [...u, ...ok.map((f) => f.name)]);
    let done = 0;
    for (const f of ok) {
      try {
        await api.upload(`/issues/${issue.key}/attachments`, f);
        done++;
      } catch (err) {
        toastError(err);
      } finally {
        setUploading((u) => { const i = u.indexOf(f.name); return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)]; });
      }
    }
    if (done) {
      toast(done === 1 ? 'File attached.' : `${done} files attached.`);
      qc.invalidateQueries({ queryKey: keys.issue(issue.key) });
      invalidateWork(qc);
    }
  }

  async function remove(a: Attachment) {
    if (!(await askConfirm({ title: `Remove ${a.name}?`, body: 'The file will be deleted for everyone.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api.del(`/attachments/${a.id}`);
      qc.invalidateQueries({ queryKey: keys.issue(issue.key) });
      invalidateWork(qc);
    } catch (err) {
      toastError(err);
    }
  }

  // Paste a screenshot straight into the open work item.
  useEffect(() => {
    if (!canEdit || IS_DEMO) return;
    const onPaste = (e: Event) => {
      const ev = e as unknown as ClipboardEvent;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const files = [...(ev.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); send(files.map((f, i) => (f.name === 'image.png' ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f))); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  if (IS_DEMO) return null;
  if (!issue.attachments.length && !canEdit) return null;
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (canEdit) send([...e.dataTransfer.files]); };
  const images = issue.attachments.filter((a) => isImage(a.mime));
  const others = issue.attachments.filter((a) => !isImage(a.mime));

  return (
    <div className="detail-section" onDragOver={(e) => { if (canEdit && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="row-between">
        <h4>Attachments {issue.attachments.length > 0 && <span className="muted-inline">· {issue.attachments.length}</span>}</h4>
        {canEdit && <button className="link-btn" onClick={() => input.current?.click()}><Icon name="attachment" size={13} /> Add files</button>}
      </div>
      <input ref={input} type="file" multiple hidden onChange={(e) => { send([...(e.target.files ?? [])]); e.target.value = ''; }} />
      {images.length > 0 && (
        <div className="attach-grid">
          {images.map((a) => (
            <figure className="attach-thumb" key={a.id}>
              <button type="button" onClick={() => setPreview(a)} aria-label={`Preview ${a.name}`}><img src={a.url} alt={a.name} loading="lazy" /></button>
              <figcaption><span className="ellipsis">{a.name}</span>
                {canEdit && (a.uploaderId === me.id || isAdmin) && <button className="icon-btn tiny" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}><Icon name="trash" size={12} /></button>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {others.map((a) => (
        <div className="attach-row" key={a.id}>
          <span className="attach-ico"><Icon name={fileIcon(a.mime)} size={15} /></span>
          <a className="ellipsis attach-name" href={`${a.url}?download`} download={a.name}>{a.name}</a>
          <span className="tiny-note">{fmtBytes(a.size)} · {a.uploaderName ?? 'Former member'} · {timeAgo(a.createdAt, locale)}</span>
          <a className="icon-btn tiny" href={`${a.url}?download`} download={a.name} aria-label={`Download ${a.name}`}><Icon name="download" size={13} /></a>
          {canEdit && (a.uploaderId === me.id || isAdmin) && <button className="icon-btn tiny" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}><Icon name="trash" size={12} /></button>}
        </div>
      ))}
      {uploading.map((name, i) => <div className="attach-row uploading" key={`${name}-${i}`}><span className="spinner-dot" /> <span className="ellipsis">Uploading {name}…</span></div>)}
      {canEdit && (
        <button type="button" className={`drop-zone ${over ? 'over' : ''}`} onClick={() => input.current?.click()}>
          <Icon name="upload" size={16} /> <span><b>Drop files here</b>, browse, or paste a screenshot · up to {MAX_MB} MB each</span>
        </button>
      )}
      {preview && <Lightbox file={preview} onClose={closePreview} />}
    </div>
  );
}

/** Full-size image preview. Escape closes only the preview, not the work item behind it. */
function Lightbox({ file, onClose }: { file: Attachment; onClose: () => void }) {
  useEffect(() => {
    // Window capture runs before the dialog's document-level handler.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={file.name} onClick={onClose}>
      <img src={file.url} alt={file.name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis">{file.name} · {fmtBytes(file.size)}</span>
        <a className="btn btn-light btn-sm" href={`${file.url}?download`} download={file.name}><Icon name="download" size={13} /> Download</a>
        <button className="btn btn-light btn-sm" onClick={onClose} autoFocus>Close</button>
      </div>
    </div>
  );
}

/** Project-defined fields in the side panel; each saves on its own. */
export function CustomFields({ issue, fields, canEdit }: { issue: IssueDetail; fields: CustomField[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const { members } = useWs();
  if (!fields.length) return null;
  const save = async (f: CustomField, value: CustomValue) => {
    qc.setQueryData<IssueDetail>(keys.issue(issue.key), (d) => d && { ...d, fields: { ...d.fields, [f.id]: value } });
    try {
      await api.put(`/issues/${issue.key}/fields/${f.id}`, { value });
    } catch (err) {
      toastError(err);
    }
    qc.invalidateQueries({ queryKey: keys.issue(issue.key) });
  };
  return (
    <div className="custom-fields">
      {fields.map((f) => {
        const v = issue.fields?.[f.id] ?? null;
        const id = `cf-${issue.id}-${f.id}`;
        return (
          <div className="form-field" key={f.id}>
            <label htmlFor={id}>{f.name}</label>
            {f.type === 'select' && (
              <select id={id} className="field-select" disabled={!canEdit} value={(v as string) ?? ''} onChange={(e) => save(f, e.target.value || null)}>
                <option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === 'multiselect' && (
              <div className="chip-picker" id={id}>
                {f.options.map((o) => {
                  const list = (v as string[]) ?? [];
                  const on = list.includes(o);
                  return <button type="button" key={o} disabled={!canEdit} className={`chip-option ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => save(f, on ? list.filter((x) => x !== o) : [...list, o])}>{o}</button>;
                })}
              </div>
            )}
            {f.type === 'person' && (
              <select id={id} className="field-select" disabled={!canEdit} value={(v as number) ?? ''} onChange={(e) => save(f, e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            {f.type === 'checkbox' && (
              <label className="check-row"><input id={id} type="checkbox" disabled={!canEdit} checked={v === true} onChange={(e) => save(f, e.target.checked)} /> <span>{v ? 'Yes' : 'No'}</span></label>
            )}
            {f.type === 'date' && <input id={id} className="text-input" type="date" disabled={!canEdit} value={(v as string) ?? ''} onChange={(e) => save(f, e.target.value || null)} />}
            {(f.type === 'text' || f.type === 'number' || f.type === 'url') && (
              <TextishField id={id} field={f} value={v} canEdit={canEdit} onSave={(next) => save(f, next)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TextishField({ id, field, value, canEdit, onSave }: { id: string; field: CustomField; value: CustomValue; canEdit: boolean; onSave: (v: CustomValue) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    const next: CustomValue = t === '' ? null : field.type === 'number' ? Number(t.replace(/,/g, '')) : t;
    if (field.type === 'number' && next !== null && !Number.isFinite(next)) { toastError(new Error(`${field.name}: enter a number`)); setDraft(value == null ? '' : String(value)); return; }
    if (next !== value) onSave(next);
  };
  return (
    <div className="input-affix">
      <input id={id} className="text-input" disabled={!canEdit} inputMode={field.type === 'number' ? 'decimal' : undefined} type={field.type === 'url' ? 'url' : 'text'}
        placeholder={field.type === 'url' ? 'https://…' : '—'} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {field.type === 'url' && value && <a className="affix-btn" href={String(value)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${field.name}`}><Icon name="link" size={14} /></a>}
    </div>
  );
}

/** "Add to Google Calendar" for one item: an all-day event on its due date. */
export function googleCalendarLink(issue: IssueDetail, url: string) {
  const day = (iso: string) => iso.replace(/-/g, '');
  const next = new Date(`${issue.dueDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = issue.startDate && issue.startDate < (issue.dueDate ?? '') ? issue.startDate : issue.dueDate!;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${issue.key} · ${issue.title}`,
    dates: `${day(start)}/${day(next.toISOString().slice(0, 10))}`,
    details: `${issue.statusName} · ${issue.priority} priority\n${url}`,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
