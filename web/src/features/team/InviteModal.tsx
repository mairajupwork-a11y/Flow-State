import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { useProviders } from '../../lib/queries';
import { copyText } from '../../lib/store';
import type { Role } from '../../lib/types';
import { DesignationSelect } from './DesignationSelect';
import { ACCESS_LEVELS, accessForDesignation } from '../../../../shared/designations.js';
import { roleName } from '../../components/AssigneePicker';

interface Invite { token: string; email: string; role: Role; designation?: string; emailed?: boolean; emailError?: string }
export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;

export function copy(text: string, message = 'Link copied.') {
  copyText(text, message);
}

export function InviteModal({ onClose }: { onClose: () => void }) {
  const { workspace, isAdmin, projects } = useWs();
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [designation, setDesignation] = useState('');
  const [roleTouched, setRoleTouched] = useState(false);
  const [projectIds, setProjectIds] = useState<number[]>(() => (projects.length === 1 ? [projects[0].id] : []));
  const pickDesignation = (d: string) => {
    setDesignation(d);
    if (!roleTouched) setRole(accessForDesignation(d) as Role); // e.g. Project Manager → Manager, React Developer → Team member
  };
  const [created, setCreated] = useState<Invite[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailOn = useProviders().data?.email ?? false;
  const tokens = raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const emails = [...new Set(tokens.filter(isEmail))];
  const invalid = tokens.filter((t) => !isEmail(t));
  // Said on screen, not just in a tooltip, so touch and screen-reader users know why Send is off.
  const blocker = emails.length && !designation.trim() ? 'Choose their designation to send the invite.' : '';

  async function create(link = false) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<Invite[]>(`/workspaces/${workspace.slug}/invites`, link ? { link: true, role, projectIds } : { emails, role, designation: designation.trim(), projectIds });
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
        ? <><button className="btn btn-light" onClick={() => { setCreated(null); setRaw(''); setDesignation(''); setRoleTouched(false); }}>Invite more</button><button className="btn btn-primary" onClick={onClose}>Done</button></>
        : <><button className="btn btn-light" onClick={() => create(true)} disabled={busy}><Icon name="link" size={14} /> Get a team link</button><button className="btn btn-primary" onClick={() => create()} disabled={busy || !emails.length || !designation.trim()}><Icon name="mail" size={14} /> {emailOn ? 'Send' : 'Create'} {emails.length > 1 ? `${emails.length} invites` : 'invite'}</button></>}>
      <div className="modal-body">
        {created ? (
          <>
            {(() => {
              const sent = created.filter((i) => i.emailed).length;
              const failed = created.filter((i) => i.email && !i.emailed && emailOn);
              if (sent) return (
                <div className="form-success" role="status"><Icon name="mail" size={15} /> Invitation email sent to {sent === 1 ? created.find((i) => i.emailed)!.email : `${sent} people`}. {failed.length ? `${failed.length} could not be emailed — share their link below.` : 'They can also use the link below.'}</div>
              );
              return <p className="page-subtitle" style={{ marginTop: 0 }}>Share {created.length === 1 ? 'this link' : 'these links'} with your {created.length === 1 && !created[0].email ? 'team — anyone with it can join as a ' + roleName(role).toLowerCase() : 'teammates'}. Each one opens a quick, free sign-up.</p>;
            })()}
            <div className="invite-links">
              {created.map((i) => (
                <div className="invite-link" key={i.token}>
                  <div style={{ minWidth: 0 }}>
                    <b>{i.email || 'Reusable team link'}</b>
                    {i.designation && <span className="invite-designation"> · {i.designation}</span>}
                    {i.email && emailOn && <span className={`invite-status ${i.emailed ? 'ok' : 'bad'}`} title={i.emailError}>{i.emailed ? ' ✓ Emailed' : ' ✕ Not emailed'}</span>}
                    <code className="ellipsis">{inviteUrl(i.token)}</code>
                    {i.emailError && <small className="invite-error">{i.emailError}</small>}
                  </div>
                  <button className="btn btn-soft btn-sm" onClick={() => copy(inviteUrl(i.token))}><Icon name="copy" size={13} /> Copy</button>
                </div>
              ))}
            </div>
            {created.length > 1 && <button className="link-btn" style={{ marginTop: 10 }} onClick={() => copy(created.map((i) => `${i.email}: ${inviteUrl(i.token)}`).join('\n'), 'All links copied.')}>Copy all links</button>}
            {!emailOn && <div className="tip-box" style={{ marginTop: 14 }}><Icon name="lightbulb" size={17} /><span>Email isn’t set up on this WorkMars yet, so paste these links into WhatsApp, Slack, Teams or your own email. An admin can switch on invitation emails — see EMAIL.md.</span></div>}
          </>
        ) : (
          <>
            {error && <div className="form-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
            <label className="form-field"><span>Email addresses</span>
              <textarea className="text-input field-textarea" data-autofocus value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="person@company.com, teammate@company.com — paste as many as you like" />
            </label>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="tiny-note">{emails.length ? `${emails.length} valid address${emails.length === 1 ? '' : 'es'}` : 'Any email works — Gmail, Outlook/Hotmail, Yahoo, company addresses. Separate with commas or new lines.'}</span>
            </div>
            {invalid.length > 0 && (
              <div className="invite-error" role="alert" style={{ marginTop: 6 }}>
                Not a full email address, so it won’t be invited: {invalid.slice(0, 5).join(', ')}{invalid.length > 5 ? ` and ${invalid.length - 5} more` : ''}
              </div>
            )}
            <DesignationSelect value={designation} onChange={pickDesignation} required
              hint={emails.length > 1 ? `All ${emails.length} people are invited with this designation — send separate invites for different roles.` : 'Shown in the invitation email and set as their job title when they join.'} />
            <fieldset className="form-field plain" style={{ marginTop: 14 }}>
              <legend>Access</legend>
              <div className="access-options">
                {ACCESS_LEVELS.map((l) => (
                  <label key={l.id} className={`access-option ${role === l.id ? 'selected' : ''}`}>
                    <input type="radio" name="access" value={l.id} checked={role === l.id} onChange={() => { setRole(l.id as Role); setRoleTouched(true); }} />
                    <span><b>{l.label}</b><small>{l.blurb}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {(role === 'member' || role === 'viewer') && projects.length > 0 && (
              <fieldset className="form-field plain" style={{ marginTop: 14 }}>
                <legend>Projects they’ll work on</legend>
                <div className="check-list">
                  {projects.map((pr) => (
                    <label key={pr.id} className="check-row">
                      <input type="checkbox" checked={projectIds.includes(pr.id)} onChange={(e) => setProjectIds((ids) => e.target.checked ? [...ids, pr.id] : ids.filter((x) => x !== pr.id))} />
                      <span className="project-glyph" style={{ background: pr.color }}>{pr.key.slice(0, 2)}</span> {pr.name}
                    </label>
                  ))}
                </div>
                <small className="tiny-note">Team members and viewers only see the projects they’re on. Managers can add them to more later.</small>
              </fieldset>
            )}
            {blocker && <p className="tiny-note" role="status" style={{ marginTop: 10 }}>{blocker}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
