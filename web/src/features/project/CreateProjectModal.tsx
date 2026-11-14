import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { useWorkspace } from '../../lib/queries';
import { toast } from '../../lib/store';
import type { MethodologyId, Project } from '../../lib/types';
import { MethodologyPicker } from '../../components/MethodologyPicker';

function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  return key ? (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 6) : '';
}

/** The first free key: OPTP, then OPTP2…, matching what the server would pick. */
function freeKey(base: string, taken: Set<string>) {
  if (!base || !taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const tail = String(n);
    const candidate = base.slice(0, 6 - tail.length) + tail;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { workspace, base } = useWs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', key: '', keyTouched: false, description: '', methodology: 'scrum' as MethodologyId });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const detail = useWorkspace(workspace.slug).data;
  const taken = new Set((detail?.takenKeys ?? detail?.projects.map((p) => p.key) ?? []).map((k) => k.toUpperCase()));
  const key = form.keyTouched ? form.key : freeKey(suggestKey(form.name), taken);
  const keyTaken = form.keyTouched && taken.has(key);
  const keyValid = /^[A-Z][A-Z0-9]{1,5}$/.test(key) && !keyTaken;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !keyValid) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.post<Project>(`/workspaces/${workspace.slug}/projects`, { name: form.name.trim(), key, autoKey: !form.keyTouched, description: form.description.trim(), methodology: form.methodology });
      await qc.invalidateQueries({ queryKey: ['ws'] });
      toast(`${p.name} is ready.`);
      onClose();
      navigate(`${base}/p/${p.key}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.');
      setBusy(false);
    }
  }

  return (
    <Modal wide title="Create a project" subtitle={`In ${workspace.name} · free, unlimited`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body stack-14">
          {error && <div className="form-error" role="alert">{error}</div>}
          <label className="form-field"><span>Project name *</span><input className="text-input" data-autofocus required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mobile Banking App" /></label>
          <div className="form-grid">
            <label className="form-field"><span>Key</span><input className="text-input mono" maxLength={6} value={key} aria-invalid={!!key && !keyValid} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''), keyTouched: true })} placeholder="MBA" />
              {keyTaken && <small className="field-hint bad" role="alert">{key} is already used by another project. <button type="button" className="link-btn" onClick={() => setForm({ ...form, key: freeKey(key, taken) })}>Use {freeKey(key, taken)}</button></small>}
              {!form.keyTouched && key && key !== suggestKey(form.name) && <small className="field-hint">{suggestKey(form.name)} is taken, so this project gets {key}.</small>}
            </label>
            <div className="form-field"><span>Preview</span><div className="key-preview">{key || 'KEY'}-101</div></div>
          </div>
          <div className="form-field"><span>Methodology</span>
            <MethodologyPicker compact value={form.methodology} onChange={(methodology) => setForm({ ...form, methodology })} />
          </div>
          <label className="form-field"><span>Description</span><textarea className="text-input field-textarea" rows={3} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional — what’s this project for?" /></label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !form.name.trim() || !keyValid}><Icon name="check" size={15} /> {busy ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
