import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { copyText } from '../../lib/store';
import type { Role } from '../../lib/types';

interface Invite { token: string; email: string; role: Role }
export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;

export function copy(text: string, message = 'Link copied.') {
  copyText(text, message);
}

export function InviteModal({ onClose }: { onClose: () => void }) {
  const { workspace, isAdmin } = useWs();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [created, setCreated] = useState<Invite[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emails = [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];

  async function create(link = false) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<Invite[]>(`/workspaces/${workspace.slug}/invites`, link ? { link: true, role } : { emails, role });
      setCreated(res);
      qc.invalidateQueries({ queryKey: ['invites'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invitations.');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <Modal title="Invite teammates" onClose={onClose}><div className="modal-body"><p className="page-subtitle" style={{ marginTop: 0 }}>Only workspace admins can invite people. Ask an admin — it’s free for everyone, so there’s no reason to hold back.</p></div></Modal>;
  }

  return (
    <Modal title="Invite teammates" subtitle="Free for unlimited people — invite your whole organisation" onClose={onClose}
      footer={created
        ? <><button className="btn btn-light" onClick={() => { setCreated(null); setRaw(''); }}>Invite more</button><button className="btn btn-primary" onClick={onClose}>Done</button></>
        : <><button className="btn btn-light" onClick={() => create(true)} disabled={busy}><Icon name="link" size={14} /> Get a team link</button><button className="btn btn-primary" onClick={() => create()} disabled={busy || !emails.length}><Icon name="mail" size={14} /> Create {emails.length > 1 ? `${emails.length} invites` : 'invite'}</button></>}>
      <div className="modal-body">
        {created ? (
          <>
            <p className="page-subtitle" style={{ marginTop: 0 }}>Share {created.length === 1 ? 'this link' : 'these links'} with your {created.length === 1 && !created[0].email ? 'team — anyone with it can join as a ' + role : 'teammates'}. Each one opens a quick, free sign-up.</p>
            <div className="invite-links">
              {created.map((i) => (
                <div className="invite-link" key={i.token}>
                  <div style={{ minWidth: 0 }}><b>{i.email || 'Reusable team link'}</b><code className="ellipsis">{inviteUrl(i.token)}</code></div>
                  <button className="btn btn-soft btn-sm" onClick={() => copy(inviteUrl(i.token))}><Icon name="copy" size={13} /> Copy</button>
                </div>
              ))}
            </div>
            {created.length > 1 && <button className="link-btn" style={{ marginTop: 10 }} onClick={() => copy(created.map((i) => `${i.email}: ${inviteUrl(i.token)}`).join('\n'), 'All links copied.')}>Copy all links</button>}
            <div className="tip-box" style={{ marginTop: 14 }}><Icon name="lightbulb" size={17} /><span>Flowstate doesn’t send emails for you yet, so paste these into Slack, Teams or your own email.</span></div>
          </>
        ) : (
          <>
            {error && <div className="form-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
            <label className="form-field"><span>Email addresses</span>
              <textarea className="text-input field-textarea" data-autofocus value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="person@company.com, teammate@company.com — paste as many as you like" />
            </label>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="tiny-note">{emails.length ? `${emails.length} valid address${emails.length === 1 ? '' : 'es'}` : 'Separate with commas, spaces or new lines'}</span>
            </div>
            <label className="form-field" style={{ marginTop: 14 }}><span>Role</span>
              <select className="field-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member — create and edit work</option>
                <option value="viewer">Viewer — read-only, ideal for stakeholders</option>
                <option value="admin">Admin — manage people and settings</option>
              </select>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
