import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { PriorityGlyph } from '../../components/ui';
import { ProgressRing } from '../project/ProjectLayout';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import type { Priority } from '../../lib/types';
import { Brand } from './Welcome';

interface Shared {
  project: { name: string; key: string; color: string; description: string; client: string; workspace: string };
  sprint: { name: string; goal: string; endDate: string | null } | null;
  progress: { total: number; done: number; pct: number };
  columns: { name: string; category: string; color: string; items: { key: string; title: string; type: string; priority: Priority; dueDate: string | null; doneAt: string | null }[] }[];
  updatedAt: string;
}

/** The public, read-only project page a client opens from a share link. */
export function SharedProject() {
  const { token = '' } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ['shared', token], queryFn: () => api.get<Shared>(`/share/${token}`), refetchInterval: 60_000, retry: false });
  if (isLoading) return <div className="share-page"><p className="muted center" style={{ marginTop: 120 }}>Loading…</p></div>;
  if (error || !data) return (
    <div className="share-page"><div className="share-missing content-card"><Icon name="lock" size={28} /><h1>This link isn’t available</h1><p className="muted">It may have been turned off. Ask the team that shared it for a new one.</p></div></div>
  );
  const { project, progress, sprint } = data;
  return (
    <div className="share-page">
      <header className="share-top"><Brand to="/welcome" height={30} /><span className="share-badge"><Icon name="eye" size={13} /> Read-only view</span></header>
      <section className="content-card share-hero">
        <span className="hero-glyph" style={{ background: project.color }}>{project.key.slice(0, 2)}</span>
        <div className="share-hero-copy">
          <small>{project.workspace}{project.client ? ` · for ${project.client}` : ''}</small>
          <h1>{project.name}</h1>
          {sprint && <p><Icon name="bolt" size={13} /> {sprint.name}{sprint.endDate ? ` · ends ${fmtDate(sprint.endDate, 'en-GB', true)}` : ''}{sprint.goal ? ` — ${sprint.goal}` : ''}</p>}
          {!sprint && project.description && <p>{project.description}</p>}
        </div>
        <div className="share-progress"><ProgressRing value={progress.pct} label="done" size={84} /><span><b>{progress.done}</b> of {progress.total} done</span></div>
      </section>
      <div className="share-board">
        {data.columns.map((c) => (
          <section key={c.name} className="share-col">
            <h2><span className="col-dot" style={{ background: c.color }} /> {c.name} <span className="col-count">{c.items.length}</span></h2>
            {c.items.map((i) => (
              <article key={i.key} className={`share-item ${c.category === 'done' ? 'done' : ''}`}>
                <div className="row-between"><small>{i.key}</small><span className={`prio-dot ${i.priority}`} title={`${i.priority} priority`}><PriorityGlyph priority={i.priority} size={12} /></span></div>
                <b>{i.title}</b>
                {(i.dueDate || i.doneAt) && <small className="share-date"><Icon name="calendar" size={11} /> {i.doneAt ? `Done ${fmtDate(i.doneAt)}` : `Due ${fmtDate(i.dueDate)}`}</small>}
              </article>
            ))}
            {!c.items.length && <p className="placeholder small">Nothing here</p>}
          </section>
        ))}
      </div>
      <footer className="share-foot">Live from WorkMars · updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</footer>
    </div>
  );
}
