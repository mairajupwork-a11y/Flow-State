import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, PageHeader, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { fmtMinutes, type TimeEntry } from '../../lib/time';
import { addDays, isoDay } from '../../lib/format';

type Range = 'week' | 'month';
interface Sheet { entries: TimeEntry[]; canSeeTeam: boolean; totalMinutes: number; billableMinutes: number }

/** Local-midnight boundaries of the week or month containing `anchor`. */
function bounds(range: Range, anchor: string, weekStart: 0 | 1) {
  const d = new Date(`${anchor}T00:00:00`);
  if (range === 'week') {
    const shift = (d.getDay() - weekStart + 7) % 7;
    const start = isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift));
    return { start, end: addDays(start, 7) };
  }
  const start = isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
  return { start, end: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
}
const localDay = (iso: string) => isoDay(new Date(iso));
const hours = (m: number) => (m ? fmtMinutes(m) : '');

export default function Timesheets() {
  const { workspace, members, projects, me, locale, canEdit } = useWs();
  const [, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('week');
  const [anchor, setAnchor] = useState(isoDay());
  const [person, setPerson] = useState<number | ''>(canEdit ? '' : me.id);
  const [projectId, setProjectId] = useState<number | ''>('');
  const { start, end } = bounds(range, anchor, workspace.weekStart);
  const qs = new URLSearchParams({ from: new Date(`${start}T00:00:00`).toISOString(), to: new Date(`${end}T00:00:00`).toISOString() });
  if (person) qs.set('userId', String(person));
  if (projectId) qs.set('projectId', String(projectId));
  const { data, isLoading } = useQuery({ queryKey: ['time', 'sheet', workspace.slug, qs.toString()], queryFn: () => api.get<Sheet>(`/workspaces/${workspace.slug}/timesheet?${qs}`) });

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [start, end]);

  // Rows: one per person + work item, with minutes per day.
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; userId: number; userName: string; issueKey: string; issueTitle: string; projectName: string; perDay: Record<string, number>; total: number }>();
    for (const e of data?.entries ?? []) {
      const k = `${e.userId}:${e.issueKey}`;
      const row = map.get(k) ?? { key: k, userId: e.userId, userName: e.userName, issueKey: e.issueKey, issueTitle: e.issueTitle, projectName: e.projectName, perDay: {}, total: 0 };
      const day = localDay(e.startedAt);
      row.perDay[day] = (row.perDay[day] ?? 0) + e.minutes;
      row.total += e.minutes;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => a.userName.localeCompare(b.userName) || b.total - a.total);
  }, [data]);
  const dayTotals = days.map((d) => rows.reduce((s, r) => s + (r.perDay[d] ?? 0), 0));
  const people = new Set(rows.map((r) => r.userId)).size;

  const label = range === 'week'
    ? `${new Date(`${start}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${new Date(`${addDays(end, -1)}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : new Date(`${start}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const move = (dir: number) => setAnchor(range === 'week' ? addDays(start, dir * 7) : isoDay(new Date(new Date(`${start}T00:00:00`).getFullYear(), new Date(`${start}T00:00:00`).getMonth() + dir, 1)));
  const csv = `/api/workspaces/${workspace.slug}/timesheet?${new URLSearchParams([...qs.entries(), ['format', 'csv']])}`;

  return (
    <>
      <PageHeader eyebrow={canEdit ? 'Team / Timesheets' : 'Personal / Timesheets'} title="Where the hours went."
        subtitle={canEdit ? 'Logged time for your whole team. Export it for invoices and payroll.' : 'Your logged time. Start a timer from any work item.'}
        actions={<a className="btn btn-primary" href={csv} download><Icon name="download" size={15} /> Export CSV</a>} />

      <div className="sheet-toolbar">
        <div className="tabs" role="tablist" aria-label="Range">
          {(['week', 'month'] as Range[]).map((r) => <button key={r} role="tab" aria-selected={range === r} className={`tab ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r === 'week' ? 'Week' : 'Month'}</button>)}
        </div>
        <div className="sheet-nav">
          <button className="icon-btn" onClick={() => move(-1)} aria-label="Previous"><Icon name="left" size={16} /></button>
          <b>{label}</b>
          <button className="icon-btn" onClick={() => move(1)} aria-label="Next"><Icon name="right" size={16} /></button>
          <button className="btn btn-light btn-sm" onClick={() => setAnchor(isoDay())}>Today</button>
        </div>
        <div className="row-8 wrap">
          {canEdit && (
            <select className="filter-select" value={person} onChange={(e) => setPerson(e.target.value ? Number(e.target.value) : '')} aria-label="Person">
              <option value="">Everyone</option>
              {members.filter((m) => m.role !== 'viewer').map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>)}
            </select>
          )}
          <select className="filter-select" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="metric-grid stat-grid">
        {([['Total', data?.totalMinutes ?? 0, 'clock', 'lime'], ['Billable', data?.billableMinutes ?? 0, 'check', 'mint'], ['Non-billable', (data?.totalMinutes ?? 0) - (data?.billableMinutes ?? 0), 'eye', 'sky'], [canEdit ? 'People' : 'Work items', canEdit ? people : rows.length, canEdit ? 'people' : 'list', 'peach']] as const).map(([lbl, v, ic, tone], i) => (
          <div key={lbl} className={`metric stat tone-${tone}`}>
            <span className="stat-ico"><Icon name={ic} size={18} /></span>
            <div className="stat-body"><span className="stat-label">{lbl}</span><span className="metric-val">{i < 3 ? fmtMinutes(v as number) : v}</span></div>
          </div>
        ))}
      </div>

      {isLoading ? <PageLoader /> : !rows.length ? (
        <div className="content-card"><Empty icon="clock" title="No time logged here yet">Open any work item and press <b>Start timer</b>, or use <b>Log time</b> when you’re done.</Empty></div>
      ) : (
        <div className="content-card table-wrap sheet-card">
          <table className="sheet-table">
            <thead>
              <tr>
                <th className="sheet-item">Work item</th>
                {range === 'week' && days.map((d) => <th key={d} className={d === isoDay() ? 'today' : ''}>{new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })}<small>{new Date(`${d}T12:00:00`).getDate()}</small></th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={i > 0 && rows[i - 1].userId !== r.userId ? 'new-person' : ''}>
                  <td className="sheet-item">
                    <button className="sheet-link" onClick={() => setParams({ issue: r.issueKey })}>
                      {canEdit && <Avatar user={members.find((m) => m.id === r.userId)} size="sm" />}
                      <span><b>{r.issueTitle}</b><small>{r.issueKey} · {r.projectName}{canEdit ? ` · ${r.userName}` : ''}</small></span>
                    </button>
                  </td>
                  {range === 'week' && days.map((d) => <td key={d} className={`num ${d === isoDay() ? 'today' : ''}`}>{hours(r.perDay[d] ?? 0)}</td>)}
                  <td className="num total">{fmtMinutes(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sheet-item">Total</td>
                {range === 'week' && dayTotals.map((t, i) => <td key={days[i]} className="num">{hours(t)}</td>)}
                <td className="num total">{fmtMinutes(data?.totalMinutes ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
