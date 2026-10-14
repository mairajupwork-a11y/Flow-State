import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PriorityPill, StatusPill, TypeIcon } from '../../components/ui';
import { useWs } from '../../lib/workspace';
import { openCreate } from '../../lib/store';
import { fmtDate, PRIORITY_RANK, timeAgo, todayISO } from '../../lib/format';
import type { Issue } from '../../lib/types';
import { FilterBar, SectionBar, useProjectCtx } from './ProjectLayout';

type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'points' | 'updated';

export function ListView() {
  const { filtered, project } = useProjectCtx();
  const { member, locale, canEdit } = useWs();
  const [, setParams] = useSearchParams();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const statusPos = useMemo(() => new Map(project.statuses.map((s) => [s.id, s.position])), [project.statuses]);

  const rows = useMemo(() => {
    const val = (i: Issue): string | number => {
      switch (sort.key) {
        case 'title': return i.title.toLowerCase();
        case 'status': return statusPos.get(i.statusId) ?? 0;
        case 'priority': return PRIORITY_RANK[i.priority];
        case 'assignee': return member(i.assigneeId)?.name ?? '~';
        case 'due': return i.dueDate ?? '9999';
        case 'points': return i.storyPoints ?? -1;
        case 'updated': return i.updatedAt;
      }
    };
    return [...filtered].sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * sort.dir;
    });
  }, [filtered, sort, statusPos, member]);

  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label} {sort.key === key && <Icon name={sort.dir === 1 ? 'up' : 'chevron'} size={12} />}
      </button>
    </th>
  );

  return (
    <>
      <SectionBar title={`Work items`} sub={`${rows.length} in view`} />
      <FilterBar count={rows.length} />
      <div className="content-card table-wrap" style={{ padding: '7px 8px' }}>
        <table className="list-table">
          <thead><tr>{th('title', 'Work item')}{th('status', 'Status')}{th('priority', 'Priority')}{th('assignee', 'Owner')}{th('due', 'Due')}{th('points', 'Pts')}{th('updated', 'Updated')}</tr></thead>
          <tbody>
            {rows.map((t) => {
              const owner = member(t.assigneeId);
              const overdue = t.dueDate && t.dueDate < todayISO() && t.statusCategory !== 'done';
              return (
                <tr key={t.id} className="clickable" tabIndex={0} onClick={() => setParams({ issue: t.key })} onKeyDown={(e) => e.key === 'Enter' && setParams({ issue: t.key })}>
                  <td><span className="list-name"><TypeIcon type={t.type} /><span><strong className={t.statusCategory === 'done' ? 'struck' : ''}>{t.title}</strong><br /><span className="subtle-key">{t.key}{t.labels.length ? ` · ${t.labels.join(', ')}` : ''}</span></span></span></td>
                  <td><StatusPill name={t.statusName} category={t.statusCategory} /></td>
                  <td><PriorityPill priority={t.priority} /></td>
                  <td><span className="row-8 nowrap"><Avatar user={owner} />{owner ? owner.name.split(' ')[0] : <span className="subtle-key">Unassigned</span>}</span></td>
                  <td className={overdue ? 'overdue nowrap' : 'nowrap'}>{t.dueDate ? fmtDate(t.dueDate, locale) : '—'}</td>
                  <td>{t.storyPoints ?? '—'}</td>
                  <td className="nowrap">{timeAgo(t.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <Empty icon="search" title="Nothing matches" action={canEdit && <button className="btn btn-soft" onClick={() => openCreate()}><Icon name="plus" size={15} /> Create a work item</button>}>Try clearing a filter, or create something new.</Empty>}
      </div>
    </>
  );
}
