import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { askConfirm, toast, ui } from '../../lib/store';
import { fmtDate, timeAgo } from '../../lib/format';
import type { Role } from '../../lib/types';
import { copy, inviteUrl } from './InviteModal';

const ROLE_HELP: Record<Role, string> = { admin: 'Manages people & settings', member: 'Creates and edits work', viewer: 'Read-only access' };

export default function Team() {
  const { workspace, members, me, isAdmin, locale } = useWs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invites = useQuery({ queryKey: ['invites', workspace.slug], queryFn: () => api.get<{ token: string; email: string; role: Role; createdAt: string }[]>(`/workspaces/${workspace.slug}/invites`), enabled: isAdmin });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ws'] }); qc.invalidateQueries({ queryKey: ['invites'] }); };
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: number; role: Role }) => api.patch(`/workspaces/${workspace.slug}/members/${id}`, { role }), onSuccess: () => { refresh(); toast('Role updated.'); } });
  const removeMember = useMutation({
    mutationFn: (id: number) => api.del(`/workspaces/${workspace.slug}/members/${id}`),
    onSuccess: (_d, id) => { if (id === me.id) { qc.invalidateQueries({ queryKey: ['session'] }); navigate('/', { replace: true }); } else { refresh(); toast('Member removed.'); } },
  });
  const revoke = useMutation({ mutationFn: (token: string) => api.del(`/workspaces/${workspace.slug}/invites/${token}`), onSuccess: () => { refresh(); toast('Invitation withdrawn.'); } });

  return (
    <>
      <PageHeader eyebrow="People / Team" title="Better together, at any size." subtitle="A workspace designed for everyone to be involved — with no seat limits, ever." />
      <div className="content-card team-banner">
        <div><h3>{workspace.name} members</h3><p className="muted">{members.length} {members.length === 1 ? 'person' : 'people'} · Unlimited users, always free</p></div>
        {isAdmin && <button className="btn btn-primary" onClick={() => ui.set({ inviteOpen: true })}><Icon name="plus" size={15} /> Invite people</button>}
      </div>

      <div className="people-grid">
        {members.map((p) => (
          <div className="content-card person-card" key={p.id}>
            <Avatar user={p} size="lg" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="ellipsis">{p.name}{p.id === me.id && <span className="you-badge">You</span>}</b>
              <small className="ellipsis">{p.jobTitle || p.email}</small>
              <small>Joined {fmtDate(p.joinedAt.slice(0, 10), locale, true)}</small>
            </div>
            <div className="person-role">
              {isAdmin ? (
                <select className="filter-select" value={p.role} onChange={(e) => setRole.mutate({ id: p.id, role: e.target.value as Role })} aria-label={`Role for ${p.name}`} title={ROLE_HELP[p.role]}>
                  <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
                </select>
              ) : <span className="status-pill">{p.role}</span>}
              {(isAdmin || p.id === me.id) && (
                <button className="icon-btn tiny" aria-label={p.id === me.id ? 'Leave workspace' : `Remove ${p.name}`} title={p.id === me.id ? 'Leave workspace' : 'Remove from workspace'}
                  onClick={async () => (await askConfirm(p.id === me.id ? { title: `Leave ${workspace.name}?`, confirmLabel: 'Leave', danger: true } : { title: `Remove ${p.name}?`, body: `They lose access to ${workspace.name}. Their work stays but becomes unassigned.`, confirmLabel: 'Remove', danger: true })) && removeMember.mutate(p.id)}>
                  <Icon name={p.id === me.id ? 'logout' : 'trash'} size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isAdmin && !!invites.data?.length && (
        <div className="content-card" style={{ marginTop: 16 }}>
          <h3>Pending invitations</h3>
          <p className="muted">Share a link again or withdraw it</p>
          {invites.data.map((i) => (
            <div className="setting-row" key={i.token}>
              <div style={{ minWidth: 0 }}><strong>{i.email || 'Reusable team link'}</strong><small>{i.role} · created {timeAgo(i.createdAt)}</small></div>
              <div className="row-8">
                <button className="btn btn-soft btn-sm" onClick={() => copy(inviteUrl(i.token))}><Icon name="copy" size={13} /> Copy link</button>
                <button className="btn btn-light btn-sm" onClick={() => revoke.mutate(i.token)}>Withdraw</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="three-col" style={{ marginTop: 16 }}>
        {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
          <div className="tip-box" key={r}><Icon name={r === 'admin' ? 'shield' : r === 'member' ? 'edit' : 'eye'} size={17} /><span><b style={{ textTransform: 'capitalize' }}>{r}s</b> — {ROLE_HELP[r].toLowerCase()}.</span></div>
        ))}
      </div>
    </>
  );
}
