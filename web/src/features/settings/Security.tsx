import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { copyText, toast } from '../../lib/store';
import { timeAgo } from '../../lib/format';
import type { Session } from '../../lib/types';

/** Turn on two-step sign-in: scan, confirm a code, save the recovery codes. */
function EnableModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.post<{ secret: string; uri: string }>('/auth/2fa/setup', {}).then(async (s) => {
      setSetup(s);
      setQr(await QRCode.toDataURL(s.uri, { margin: 1, width: 220, color: { dark: '#282c20', light: '#ffffff' } }));
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not start the setup.'));
  }, []);
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await api.post<Session & { recoveryCodes: string[] }>('/auth/2fa/enable', { code });
      qc.setQueryData(keys.session, { user: res.user, workspaces: res.workspaces });
      setCodes(res.recoveryCodes);
    } catch (err) { setError(err instanceof Error ? err.message : 'That code didn’t match.'); }
    setBusy(false);
  }
  const download = () => {
    const blob = new Blob([`WorkMars recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes?.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workmars-recovery-codes.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Modal title={codes ? 'Save your recovery codes' : 'Turn on two-step sign-in'} subtitle={codes ? 'If you lose your phone, each code lets you in once.' : 'An extra code from your phone each time you sign in.'} onClose={onClose}
      footer={codes ? <><button className="btn btn-light" onClick={download}><Icon name="download" size={14} /> Download</button><button className="btn btn-primary" onClick={() => { toast('Two-step sign-in is on.'); onClose(); }}>I’ve saved them</button></>
        : <button className="btn btn-primary" form="twofa-form" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button>}>
      <div className="modal-body stack-14">
        {error && <div className="form-error" role="alert">{error}</div>}
        {codes ? (
          <>
            <div className="recovery-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
            <button className="btn btn-soft btn-sm" onClick={() => copyText(codes.join('\n'), 'Recovery codes copied.')}><Icon name="copy" size={13} /> Copy all</button>
          </>
        ) : (
          <form id="twofa-form" onSubmit={confirm} className="twofa-setup">
            <ol className="plain-steps">
              <li>Install an authenticator app: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b>, <b>Authy</b> or <b>1Password</b>.</li>
              <li>Scan this code with it.</li>
            </ol>
            <div className="twofa-qr">{qr ? <img src={qr} alt="QR code to add WorkMars to your authenticator app" width={180} height={180} /> : <span className="muted">Preparing…</span>}</div>
            {setup && <p className="tiny-note center">Can’t scan? Enter this key: <button type="button" className="link-btn mono" onClick={() => copyText(setup.secret, 'Key copied.')}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</button></p>}
            <label className="form-field"><span>3. Enter the 6-digit code it shows</span>
              <input className="text-input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} placeholder="123456" />
            </label>
          </form>
        )}
      </div>
    </Modal>
  );
}

function DisableModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const s = await api.post<Session>('/auth/2fa/disable', { code });
      qc.setQueryData(keys.session, s);
      toast('Two-step sign-in is off.'); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'That code didn’t match.'); }
  }
  return (
    <Modal title="Turn off two-step sign-in?" subtitle="Your account will only be protected by your password." onClose={onClose}
      footer={<><button className="btn btn-light" onClick={onClose}>Keep it on</button><button className="btn btn-danger" form="twofa-off" disabled={code.length < 6}>Turn off</button></>}>
      <form id="twofa-off" className="modal-body stack-14" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label className="form-field"><span>Code from your app (or a recovery code)</span>
          <input className="text-input code-input" autoFocus maxLength={12} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="123456" />
        </label>
      </form>
    </Modal>
  );
}

/** Settings row: two-step sign-in status with a turn on / off action. */
export function TwoFactorRow() {
  const { me } = useWs();
  const [open, setOpen] = useState<'on' | 'off' | null>(null);
  return (
    <div className="setting-row">
      <div><strong><Icon name="lock" size={14} /> Two-step sign-in {me.twoFactor && <span className="soft-chip on-chip">On</span>}</strong>
        <small>{me.twoFactor ? 'Signing in needs your password and a code from your phone.' : 'Add a code from your phone when signing in. Recommended for admins and managers.'}</small></div>
      {me.twoFactor ? <button className="btn btn-light btn-sm" onClick={() => setOpen('off')}>Turn off</button> : <button className="btn btn-primary btn-sm" onClick={() => setOpen('on')}>Turn on</button>}
      {open === 'on' && <EnableModal onClose={() => setOpen(null)} />}
      {open === 'off' && <DisableModal onClose={() => setOpen(null)} />}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'member.role': 'Changed access level', 'member.designation': 'Changed designation', 'member.removed': 'Removed a member', 'member.left': 'Left the workspace',
  'invite.created': 'Invited', 'invite.revoked': 'Withdrew an invitation', 'workspace.settings': 'Changed workspace settings',
  'project.deleted': 'Deleted a project', 'project.archived': 'Archived a project', 'project.restored': 'Restored a project', 'project.team': 'Changed a project team',
  'project.methodology': 'Changed a project’s method', 'project.import': 'Imported work', 'integration.added': 'Connected a tool', 'integration.removed': 'Disconnected a tool',
  'security.2fa_on': 'Turned on two-step sign-in', 'security.2fa_off': 'Turned off two-step sign-in',
};
interface AuditItem { id: number; action: string; target: string; detail: string; ip: string; userName: string; createdAt: string }

/** Admins: the latest sensitive changes, with a CSV download for security reviews. */
export function AuditCard() {
  const { workspace, locale } = useWs();
  const [all, setAll] = useState(false);
  const { data } = useQuery({ queryKey: ['audit', workspace.slug], queryFn: () => api.get<AuditItem[]>(`/workspaces/${workspace.slug}/audit`) });
  const items = (data ?? []).slice(0, all ? 200 : 8);
  return (
    <div className="content-card">
      <div className="dash-card-head">
        <h3><span className="dash-ico violet"><Icon name="shield" size={15} /></span> Audit log</h3>
        <a className="btn btn-light btn-sm" href={`/api/workspaces/${workspace.slug}/audit?format=csv`} download><Icon name="download" size={13} /> CSV</a>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Who changed access, people, projects and connections — for security reviews.</p>
      <ul className="audit-list">
        {items.map((a) => (
          <li key={a.id}>
            <span><b>{a.userName}</b> {(ACTION_LABEL[a.action] ?? a.action).toLowerCase()}{a.target && <> · <i>{a.target}</i></>}{a.detail && <span className="muted-inline"> ({a.detail})</span>}</span>
            <small>{timeAgo(a.createdAt.replace(' ', 'T') + (a.createdAt.includes('Z') ? '' : 'Z'), locale)}{a.ip ? ` · ${a.ip}` : ''}</small>
          </li>
        ))}
        {!items.length && <li className="placeholder small">Nothing yet. Changes to people, access and projects will show here.</li>}
      </ul>
      {(data?.length ?? 0) > 8 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${data!.length}`}</button>}
    </div>
  );
}
