import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, ErrorState, PageHeader, PageLoader, PriorityPill, StatusPill, TypeIcon } from '../../components/ui';
import { useMyIssues } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { openCreate, openGuide } from '../../lib/store';
import { daysBetween, fmtDate, todayISO, PRIORITY_RANK } from '../../lib/format';
import type { Issue } from '../../lib/types';

const GROUPS = ['Overdue', 'Today', 'This week', 'Later', 'No due date'] as const;

export function MyTasks() {
  const { workspace, projects, canEdit, locale } = useWs();
  const { data, error, refetch } = useMyIssues(workspace.slug);
  const [, setParams] = useSearchParams();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const today = todayISO();

  const grouped = useMemo(() => {
    const open = (data ?? []).filter((i) => i.statusCategory !== 'done' && i.type !== 'epic');
    const g: Record<(typeof GROUPS)[number], Issue[]> = { Overdue: [], Today: [], 'This week': [], Later: [], 'No due date': [] };
    for (const i of open) {
      if (!i.dueDate) g['No due date'].push(i);
      else if (i.dueDate < today) g.Overdue.push(i);
      else if (i.dueDate === today) g.Today.push(i);
      else if (daysBetween(today, i.dueDate) <= 7) g['This week'].push(i);
      else g.Later.push(i);
    }
    g['No due date'].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return g;
  }, [data, today]);

  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!data) return <PageLoader />;
  const done = data.filter((i) => i.statusCategory === 'done').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  const openCount = GROUPS.reduce((a, g) => a + grouped[g].length, 0);
  const projectOf = (id: number) => projects.find((p) => p.id === id);

  const row = (t: Issue) => {
    const p = projectOf(t.projectId);
    return (
      <tr key={t.id} className="clickable" tabIndex={0} onClick={() => setParams({ issue: t.key })} onKeyDown={(e) => e.key === 'Enter' && setParams({ issue: t.key })}>
        <td><span className="list-name"><TypeIcon type={t.type} /><span><strong className={t.statusCategory === 'done' ? 'struck' : ''}>{t.title}</strong><br /><span className="subtle-key">{t.key}<span className="show-phone">{p ? ` · ${p.name}` : ''}</span></span></span></span></td>
        <td className="hide-phone">{p && <span className="row-8 nowrap"><span className="project-glyph sm" style={{ background: p.color }}>{p.name[0]}</span>{p.name}</span>}</td>
        <td><StatusPill name={t.statusName} category={t.statusCategory} /></td>
        <td className="hide-phone"><PriorityPill priority={t.priority} /></td>
        <td className={`nowrap ${t.dueDate && t.dueDate < today && t.statusCategory !== 'done' ? 'overdue' : ''}`}>{t.dueDate ? fmtDate(t.dueDate, locale) : '—'}</td>
      </tr>
    );
  };

  return (
    <>
      <PageHeader eyebrow="Personal / Assigned to me" title="Your work, clearly in view." subtitle="Everything assigned to you across every project — grouped by when it’s due."
        actions={<>
          <button className="btn btn-light" onClick={() => openGuide('Prioritise my day')}><Icon name="sparkles" size={16} /><span className="btn-label-mobile">Prioritise for me</span></button>
          {canEdit && <button className="btn btn-primary" onClick={() => openCreate()}><Icon name="plus" size={16} /> Create task</button>}
        </>} />
      <div className="section-bar">
        <span className="section-heading">{tab === 'open' ? `Open work ${openCount}` : `Completed ${done.length}`}</span>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'open'} className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>Open</button>
          <button role="tab" aria-selected={tab === 'done'} className={`tab ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>Done</button>
        </div>
      </div>
      {tab === 'open' ? (
        openCount ? GROUPS.filter((g) => grouped[g].length).map((g) => (
          <div className={`content-card table-wrap group-card ${g === 'Overdue' ? 'is-overdue' : ''}`} key={g} style={{ padding: '7px 8px', marginBottom: 14 }}>
            <div className="group-title">{g === 'Overdue' && <Icon name="flag" size={14} />}{g} <span className="col-count">{grouped[g].length}</span></div>
            <table className="list-table"><tbody>{grouped[g].map(row)}</tbody></table>
          </div>
        )) : <div className="content-card"><Empty title="Nothing assigned to you" icon="checkcircle">When teammates assign work to you, it shows up here. You can also assign yourself from any card.</Empty></div>
      ) : (
        <div className="content-card table-wrap" style={{ padding: '7px 8px' }}>
          <table className="list-table"><tbody>{done.slice(0, 50).map(row)}</tbody></table>
          {!done.length && <Empty title="No finished work yet" icon="trend">Completed items will collect here — a nice record of progress.</Empty>}
        </div>
      )}
    </>
  );
}
