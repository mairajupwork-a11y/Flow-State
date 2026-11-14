import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/ui';
import { roleName } from '../../components/AssigneePicker';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast } from '../../lib/store';
import type { ProjectDetail, Role } from '../../lib/types';

const RANK: Record<Role, number> = { admin: 0, manager: 1, member: 2, viewer: 3 };

/**
 * The people who work on a project, chosen with checkboxes by managers.
 * Team members and viewers only see projects they're on; managers and admins see every project anyway.
 */
export function ResourcesCard({ project }: { project: ProjectDetail }) {
  const { members, canEdit, me } = useWs();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<number[]>(project.memberIds ?? []);
  const [q, setQ] = useState('');
  useEffect(() => setPicked(project.memberIds ?? []), [project.memberIds]);
  const save = useMutation({
    mutationFn: (userIds: number[]) => api.put(`/projects/${project.id}/members`, { userIds }),
    onSuccess: () => { invalidateWork(qc); qc.invalidateQueries({ queryKey: ['ws'] }); toast('Project team saved.'); },
  });
  const sorted = useMemo(() => [...members].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name)), [members]);
  const shown = sorted.filter((m) => !q.trim() || `${m.name} ${m.jobTitle} ${m.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const dirty = [...picked].sort().join() !== [...(project.memberIds ?? [])].sort().join();
  const contributors = sorted.filter((m) => m.role === 'member' || m.role === 'viewer');
  const allContributors = contributors.length > 0 && contributors.every((m) => picked.includes(m.id));

  return (
    <div className="content-card resources-card">
      <div className="row-between wrap">
        <div>
          <h3><Icon name="people" size={16} /> Team on this project</h3>
          <p className="muted">{picked.length} {picked.length === 1 ? 'person' : 'people'} · Team members and viewers only see the projects they’re on. Managers and admins see every project.</p>
        </div>
        {canEdit && (
          <div className="row-8">
            {contributors.length > 0 && (
              <button type="button" className="btn btn-light btn-sm" onClick={() => setPicked((ids) => allContributors ? ids.filter((id) => !contributors.some((m) => m.id === id)) : [...new Set([...ids, ...contributors.map((m) => m.id)])])}>
                {allContributors ? 'Clear team members' : 'Add every team member'}
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(picked)}><Icon name="check" size={13} /> Save team</button>
          </div>
        )}
      </div>
      {members.length > 8 && <input className="text-input slim" style={{ marginTop: 12 }} placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />}
      <div className="resource-grid">
        {shown.map((m) => {
          const lead = m.role === 'admin' || m.role === 'manager';
          return (
            <label key={m.id} className={`resource ${picked.includes(m.id) ? 'on' : ''}`}>
              <input type="checkbox" disabled={!canEdit} checked={picked.includes(m.id)}
                onChange={(e) => setPicked((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))} />
              <Avatar user={m} size="sm" />
              <span className="resource-name">
                <b>{m.name}{m.id === me.id ? ' (you)' : ''}</b>
                <small>{m.jobTitle || '—'} · <span className={`role-tag role-${m.role}`}>{roleName(m.role)}</span>{lead && !picked.includes(m.id) ? ' · sees it anyway' : ''}</small>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
