import { SCENES, sceneStyle } from '../../lib/scenes';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { keys, useProviders } from '../../lib/queries';
import { Icon } from '../../components/Icon';
import { Avatar, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { askConfirm, toast, ui } from '../../lib/store';
import { fmtDate, timeAgo } from '../../lib/format';
import type { Role, Session } from '../../lib/types';
import { copy, inviteUrl } from './InviteModal';
import { DesignationSelect } from './DesignationSelect';
import { ACCESS_LEVELS, accessForDesignation } from '../../../../shared/designations.js';
import { roleName } from '../../components/AssigneePicker';

const ROLE_HELP = Object.fromEntries(ACCESS_LEVELS.map((l) => [l.id, l.blurb])) as Record<Role, string>;
const ROLE_ICON: Record<Role, string> = { admin: 'shield', manager: 'target', member: 'edit', viewer: 'eye' };
const RANK: Record<Role, number> = { admin: 0, manager: 1, member: 2, viewer: 3 };

export default function Team() {
  const { workspace, members, me, isAdmin, locale } = useWs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invites = useQuery({ queryKey: ['invites', workspace.slug], queryFn: () => api.get<{ token: string; email: string; role: Role; designation?: string; createdAt: string }[]>(`/workspaces/${workspace.slug}/invites`), enabled: isAdmin });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ws'] }); qc.invalidateQueries({ queryKey: ['invites'] }); };
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: number; role: Role }) => api.patch(`/workspaces/${workspace.slug}/members/${id}`, { role }), onSuccess: () => { refresh(); toast('Access level updated.'); } });
  // A new designation also suggests the usual access level (admins stay admins).
  const setDesignation = useMutation({
    mutationFn: ({ id, designation, role }: { id: number; designation: string; role?: Role }) => api.patch(`/workspaces/${workspace.slug}/members/${id}`, { designation, ...(role && { role }) }),
    onSuccess: (_d, v) => { refresh(); qc.invalidateQueries({ queryKey: keys.session }); toast(v.role ? `Designation saved — access set to ${roleName(v.role)}.` : 'Designation saved.'); },
  });
  const sorted = [...members].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
  const removeMember = useMutation({
    mutationFn: (id: number) => api.del(`/workspaces/${workspace.slug}/members/${id}`),
    onSuccess: (_d, id) => {
      if (id !== me.id) { refresh(); toast('Member removed.'); return; }
      // Left the workspace: forget it locally before Home picks where to go.
      qc.setQueryData<Session>(keys.session, (s) => s && { ...s, workspaces: s.workspaces.filter((w) => w.slug !== workspace.slug) });
      qc.removeQueries({ queryKey: ['ws', workspace.slug] });
      try { localStorage.removeItem('fs_last_ws'); } catch { /* storage blocked */ }
      qc.invalidateQueries({ queryKey: keys.session });
      navigate('/', { replace: true });
      toast(`You left ${workspace.name}.`);
    },
  });
  const resend = useMutation({ mutationFn: (token: string) => api.post(`/workspaces/${workspace.slug}/invites/${token}/resend`, {}), onSuccess: (_d, token) => toast(`Invitation email re-sent to ${invites.data?.find((i) => i.token === token)?.email}.`) });
  const emailOn = useProviders().data?.email ?? false;
  const revoke = useMutation({ mutationFn: (token: string) => api.del(`/workspaces/${workspace.slug}/invites/${token}`), onSuccess: () => { refresh(); toast('Invitation withdrawn.'); } });

  return (
    <>
      <PageHeader eyebrow="People / Team" title="Better together, at any size." subtitle="A workspace designed for everyone to be involved — with no seat limits, ever." />
      <div className="content-card team-banner scene" style={sceneStyle(SCENES[1]) as CSSProperties}>
        <div><h3>{workspace.name} members</h3><p className="muted">{members.length} {members.length === 1 ? 'person' : 'people'} · Unlimited users, always free</p></div>
        {isAdmin && <button className="btn btn-primary" onClick={() => ui.set({ inviteOpen: true })}><Icon name="plus" size={15} /> Invite people</button>}
      </div>

      <div className="people-grid">
        {sorted.map((p) => (
          <div className={`content-card person-card ${isAdmin ? 'editable' : ''}`} key={p.id}>
            <Avatar user={p} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="ellipsis">{p.name}{p.id === me.id && <span className="you-badge">You</span>}</b>
              <small className="ellipsis">{p.jobTitle || p.email}</small>
              <small>Joined {fmtDate(p.joinedAt.slice(0, 10), locale, true)}</small>
            </div>
            {isAdmin && (
              <div className="person-controls">
                <label><span>Designation</span>
                  <DesignationSelect compact label={`Designation for ${p.name}`} value={p.jobTitle} onChange={(designation) => {
                    const suggested = accessForDesignation(designation) as Role;
                    setDesignation.mutate({ id: p.id, designation, role: p.role !== 'admin' && suggested !== p.role ? suggested : undefined });
                  }} />
                </label>
                <label><span>Access</span>
                  <select className="filter-select" value={p.role} onChange={(e) => setRole.mutate({ id: p.id, role: e.target.value as Role })} aria-label={`Access level for ${p.name}`} title={ROLE_HELP[p.role]}>
                    {ACCESS_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="person-role">
              {!isAdmin && <span className={`status-pill role-${p.role}`}>{roleName(p.role)}</span>}
              {(isAdmin || p.id === me.id) && (
                <button className="icon-btn tiny" aria-label={p.id === me.id ? 'Leave workspace' : `Remove ${p.name}`} title={p.id === me.id ? 'Leave workspace' : 'Remove from workspace'}
                  onClick={async () => (await askConfirm(p.id === me.id ? { title: `Leave ${workspace.name}?`, confirmLabel: 'Leave', danger: true } : { title: `Remove ${p.name}?`, body: `They lose access to ${workspace.name}. Their work stays but becomes unassigned.`, confirmLabel: 'Remove', danger: true })) && removeMember.mutate(p.id)}>
                  <Icon name={p.id === me.id ? 'logout' : 'trash'} size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {isAdmin && (
          <button className="content-card person-card invite-slot" onClick={() => ui.set({ inviteOpen: true })}>
            <span className="invite-slot-icon"><Icon name="plus" size={18} /></span>
            <div><b>Invite a teammate</b><small>Free for everyone — no seat limits.</small></div>
          </button>
        )}
      </div>

      {isAdmin && !!invites.data?.length && (
        <div className="content-card" style={{ marginTop: 16 }}>
          <h3>Pending invitations</h3>
          <p className="muted">{emailOn ? 'Resend the email, share the link, or withdraw it' : 'Share a link again or withdraw it'}</p>
          {invites.data.map((i) => (
            <div className="setting-row" key={i.token}>
              <div style={{ minWidth: 0 }}><strong>{i.email || 'Reusable team link'}</strong><small>{i.designation ? `${i.designation} · ` : ''}{roleName(i.role)} · created {timeAgo(i.createdAt, locale)}</small></div>
              <div className="row-8">
                {emailOn && i.email && <button className="btn btn-soft btn-sm" disabled={resend.isPending} onClick={() => resend.mutate(i.token)}><Icon name="mail" size={13} /> Resend</button>}
                <button className="btn btn-soft btn-sm" onClick={() => copy(inviteUrl(i.token))}><Icon name="copy" size={13} /> Copy link</button>
                <button className="btn btn-light btn-sm" onClick={async () => (await askConfirm({ title: 'Withdraw this invitation?', body: `${i.email || 'The team link'} will stop working. You can always invite them again.`, confirmLabel: 'Withdraw' })) && revoke.mutate(i.token)}>Withdraw</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="role-legend" style={{ marginTop: 16 }}>
        {ACCESS_LEVELS.map((l) => (
          <div className="tip-box" key={l.id}><Icon name={ROLE_ICON[l.id]} size={17} /><span><b>{l.label}</b> — {l.blurb}</span></div>
        ))}
      </div>
    </>
  );
}
