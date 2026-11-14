import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { askConfirm, copyText, toast, toastError } from '../../lib/store';
import { timeAgo } from '../../lib/format';
import { useWs } from '../../lib/workspace';
import type { ProjectDetail } from '../../lib/types';

interface Link { id: number; label: string; url: string; createdAt: string }

/** Read-only progress links for clients: titles, columns and dates only — never comments, files or people. */
export function ShareCard({ project }: { project: ProjectDetail }) {
  const { locale } = useWs();
  const qc = useQueryClient();
  const [label, setLabel] = useState(project.client ?? '');
  const { data } = useQuery({ queryKey: ['share', project.id], queryFn: () => api.get<Link[]>(`/projects/${project.id}/share`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['share', project.id] });
  const create = useMutation({ mutationFn: () => api.post<Link>(`/projects/${project.id}/share`, { label }), onSuccess: (l) => { refresh(); copyText(l.url, 'Link created and copied — send it to your client.'); }, onError: toastError });
  const revoke = useMutation({ mutationFn: (id: number) => api.del(`/share-links/${id}`), onSuccess: () => { refresh(); toast('Link turned off.'); } });
  return (
    <div className="content-card share-card">
      <div className="dash-card-head"><h3><span className="dash-ico peach"><Icon name="globe" size={15} /></span> Share with your client</h3></div>
      <p className="muted" style={{ marginTop: 0 }}>A read-only page with live progress: columns, titles, priorities and dates. No sign-in needed. Comments, files, people and descriptions stay private.</p>
      <div className="row-8 wrap" style={{ marginTop: 12 }}>
        <input className="text-input" style={{ flex: '1 1 200px' }} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Who is it for? e.g. Acme Corp" aria-label="Link label" />
        <button className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}><Icon name="link" size={14} /> Create link</button>
      </div>
      {!!data?.length && (
        <ul className="share-list">
          {data.map((l) => (
            <li key={l.id}>
              <span><b>{l.label || 'Client link'}</b><small>Created {timeAgo(l.createdAt.replace(' ', 'T') + 'Z', locale)}</small></span>
              <a className="btn btn-light btn-sm" href={l.url} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={13} /> Preview</a>
              <button className="btn btn-soft btn-sm" onClick={() => copyText(l.url, 'Link copied.')}><Icon name="copy" size={13} /> Copy</button>
              <button className="icon-btn" aria-label="Turn off this link" onClick={async () => (await askConfirm({ title: 'Turn off this link?', body: 'Anyone using it will see “link not found”.', confirmLabel: 'Turn off', danger: true })) && revoke.mutate(l.id)}><Icon name="trash" size={15} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
