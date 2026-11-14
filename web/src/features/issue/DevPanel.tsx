import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { plural, timeAgo } from '../../lib/format';

interface DevLink { id: number; provider: 'github' | 'gitlab'; kind: 'pr' | 'commit' | 'branch'; extId: string; title: string; url: string; state: string; author: string; updatedAt: string }
const KIND_ICON = { pr: 'arrow', commit: 'check', branch: 'timeline' } as const;

/** Branches, commits and pull/merge requests that mention this work item. */
export function DevPanel({ issueKey }: { issueKey: string }) {
  const { locale } = useWs();
  const { data } = useQuery({ queryKey: ['dev', issueKey], queryFn: () => api.get<DevLink[]>(`/issues/${issueKey}/dev`) });
  if (!data?.length) return null;
  const order = { pr: 0, branch: 1, commit: 2 };
  const links = [...data].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <div className="detail-section dev-panel">
      <h4><Icon name="link" size={14} /> Development <span className="muted-inline">· {plural(data.filter((l) => l.kind === 'pr').length, 'request')} · {plural(data.filter((l) => l.kind === 'commit').length, 'commit')}</span></h4>
      <ul>
        {links.slice(0, 10).map((l) => (
          <li key={l.id}>
            <span className={`dev-ico ${l.kind}`}><Icon name={KIND_ICON[l.kind]} size={13} /></span>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="dev-title">{l.title}</a>
            {l.kind === 'pr' && <span className={`dev-state ${l.state}`}>{l.state}</span>}
            <small>{l.provider === 'github' ? 'GitHub' : 'GitLab'}{l.author ? ` · ${l.author}` : ''} · {timeAgo(l.updatedAt, locale)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
