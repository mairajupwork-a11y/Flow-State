import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PageHeader, PageLoader, PriorityGlyph } from '../../components/ui';
import { roleName } from '../../components/AssigneePicker';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { fmtMinutes } from '../../lib/time';
import { relativeDay } from '../../lib/format';
import type { Priority } from '../../lib/types';

interface Person {
  userId: number; name: string; color: string; jobTitle: string; role: string; open: number; inProgress: number; points: number; overdue: number;
  dueThisWeek: number; urgent: number; minutesThisWeek: number; doneThisWeek: number; load: 'high' | 'ok' | 'light' | 'free';
  items: { key: string; title: string; priority: Priority; dueDate: string | null; status: string; project: string }[];
}
const LOAD: Record<Person['load'], [string, string]> = { high: ['Overloaded', 'rose'], ok: ['Balanced', 'mint'], light: ['Has room', 'sky'], free: ['Free', 'lime'] };

/** Who has too much and who has room — for managers planning the week. */
export default function Workload() {
  const { workspace, members, projects, canEdit } = useWs();
  const [, setParams] = useSearchParams();
  const [projectId, setProjectId] = useState<number | ''>('');
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['workload', workspace.slug, projectId], queryFn: () => api.get<{ people: Person[]; average: number }>(`/workspaces/${workspace.slug}/workload${projectId ? `?projectId=${projectId}` : ''}`), enabled: canEdit });
  if (!canEdit) return <><PageHeader eyebrow="Team / Workload" title="Who’s got what." /><div className="content-card"><Empty icon="lock" title="For managers">Project managers, team leads and admins can see everyone’s workload here.</Empty></div></>;
  const max = Math.max(1, ...(data?.people ?? []).map((p) => p.open));
  const people = [...(data?.people ?? [])].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  return (
    <>
      <PageHeader eyebrow="Team / Workload" title="Who’s got what." subtitle={data ? `Open work per person · team average ${data.average} items. Spread the load before anyone burns out.` : 'Open work per person.'}
        actions={<select className="filter-select" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>} />
      {isLoading ? <PageLoader /> : !people.length ? <div className="content-card"><Empty icon="people" title="No one to show yet">Invite your team and assign work to see the balance here.</Empty></div> : (
        <div className="content-card wl-card">
          {people.map((p) => {
            const [label, tone] = LOAD[p.load];
            return (
              <div key={p.userId} className={`wl-row ${open === p.userId ? 'open' : ''}`}>
                <button className="wl-head" onClick={() => setOpen(open === p.userId ? null : p.userId)} aria-expanded={open === p.userId}>
                  <Avatar user={members.find((m) => m.id === p.userId)} size="lg" />
                  <span className="wl-who"><b>{p.name}</b><small>{p.jobTitle || roleName(p.role)}</small></span>
                  <span className="wl-bar" aria-label={`${p.open} open items`}><i style={{ width: `${(p.open / max) * 100}%` }} className={`tone-${tone}`} /><em>{p.open} open</em></span>
                  <span className="wl-stats">
                    {p.overdue > 0 && <span className="wl-chip rose"><Icon name="clock" size={12} /> {p.overdue} overdue</span>}
                    <span className="wl-chip"><Icon name="calendar" size={12} /> {p.dueThisWeek} due this week</span>
                    <span className="wl-chip"><Icon name="check" size={12} /> {p.doneThisWeek} done</span>
                    {p.minutesThisWeek > 0 && <span className="wl-chip"><Icon name="clock" size={12} /> {fmtMinutes(p.minutesThisWeek)} this week</span>}
                  </span>
                  <span className={`wl-load ${tone}`}>{label}</span>
                  <Icon name="chevron" size={16} />
                </button>
                {open === p.userId && (
                  <ul className="wl-items">
                    {p.items.map((i) => (
                      <li key={i.key}><button onClick={() => setParams({ issue: i.key })}>
                        <span className={`prio-dot ${i.priority}`}><PriorityGlyph priority={i.priority} size={13} /></span>
                        <span className="next-copy"><b>{i.title}</b><small>{i.key} · {i.project} · {i.status}</small></span>
                        {i.dueDate && <span className={`due-chip ${i.dueDate < new Date().toISOString().slice(0, 10) ? 'late' : ''}`}><Icon name="calendar" size={12} />{relativeDay(i.dueDate)}</span>}
                      </button></li>
                    ))}
                    {!p.items.length && <li className="placeholder small">Nothing open — free to take something new.</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
