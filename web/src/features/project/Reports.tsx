import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, ErrorState, PageLoader } from '../../components/ui';
import { useReports } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { PRIORITY_LABEL, TYPE_LABEL, fmtDate } from '../../lib/format';
import type { Reports as ReportsData } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

/*
 * Charts follow one system: series colours come from validated tokens
 * (--series-1..3, re-stepped for dark mode), every multi-series chart has a
 * legend, marks have hover tooltips, and each chart offers a table view.
 */

export default function Reports() {
  const { project } = useProjectCtx();
  const { data, error, refetch } = useReports(project.id);
  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!data) return <PageLoader />;
  const t = data.totals;
  return (
    <>
      <SectionBar title="Project insights" sub="Live from your project data" />
      <div className="metric-grid">
        <Stat label="Completion" value={`${t.total ? Math.round((t.done / t.total) * 100) : 0}%`} foot={`${t.done} of ${t.total} items done`} icon="checkcircle" tone={['#e5f8f2', '#20af8b']} />
        <Stat label="In progress" value={t.inProgress} foot="Active right now" icon="loader" tone={['#eaf3ff', '#608edb']} />
        <Stat label="Overdue" value={t.overdue} foot={t.overdue ? 'Need a new date or owner' : 'Nothing overdue'} icon="flag" tone={['#fff0ed', '#dc8061']} />
        <Stat label="Avg. cycle time" value={t.cycleTimeDays == null ? '—' : t.cycleTimeDays < 1 ? '<1d' : `${t.cycleTimeDays}d`} foot="Created → done, last 30 days" icon="clock" tone={['#eeeaff', '#6f63e8']} />
      </div>
      <div className="two-col">
        {project.template === 'scrum' ? <Burndown data={data} /> : <StatusCard data={data} />}
        {project.template === 'scrum' ? <Velocity data={data} /> : <PriorityCard data={data} />}
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        <Flow data={data} />
        <Workload data={data} />
      </div>
      {project.template === 'scrum' && (
        <div className="two-col" style={{ marginTop: 16 }}>
          <StatusCard data={data} />
          <PriorityCard data={data} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value, foot, icon, tone }: { label: string; value: ReactNode; foot: string; icon: string; tone: [string, string] }) {
  return (
    <div className="metric">
      <div className="metric-head"><span>{label}</span><span className="metric-symbol" style={{ background: tone[0], color: tone[1] }}><Icon name={icon} size={17} /></span></div>
      <div className="metric-val">{value}</div>
      <div className="metric-foot">{foot}</div>
    </div>
  );
}

/** Card with a chart ↔ table switch. */
function ChartCard({ title, sub, legend, table, children }: { title: string; sub: string; legend?: [string, string, boolean?][]; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="content-card chart-card">
      <div className="row-between">
        <div><h3>{title}</h3><p className="muted">{sub}</p></div>
        <button className="link-btn" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? 'View chart' : 'View table'}</button>
      </div>
      {legend && !asTable && (
        <div className="legend" aria-hidden="true">
          {legend.map(([label, color, dashed]) => <span key={label}><i style={{ background: dashed ? 'transparent' : color, borderColor: color }} className={dashed ? 'dashed' : ''} />{label}</span>)}
        </div>
      )}
      {asTable ? <div className="table-wrap">{table}</div> : children}
    </div>
  );
}

interface Tip { x: number; y: number; lines: string[] }
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.lines.map((l, i) => <div key={i} className={i ? '' : 'tip-head'}>{l}</div>)}</div>;
}

const W = 520;
const H = 210;
const PAD = { l: 34, r: 12, t: 12, b: 26 };
/** Rounds up so the four gridlines land on friendly numbers (e.g. 0/10/20/30/40). */
const niceMax = (v: number) => {
  const raw = Math.max(v, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return Math.max(4, step * 4);
};

function Axis({ max, ticks = 4 }: { max: number; ticks?: number }) {
  return (
    <g className="axis">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i;
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - i / ticks);
        return <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className={i ? 'grid' : 'base'} /><text x={PAD.l - 8} y={y + 3} textAnchor="end">{Number.isInteger(v) ? v : v.toFixed(1)}</text></g>;
      })}
    </g>
  );
}

function Burndown({ data }: { data: ReportsData }) {
  const { locale } = useWs();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const b = data.burndown;
  if (!b) return <div className="content-card"><h3>Sprint burndown</h3><Empty icon="chart" title="No active sprint">Start a sprint from the backlog to see how work burns down day by day.</Empty></div>;
  const max = niceMax(b.total);
  const n = b.points.length - 1 || 1;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const actual = b.points.filter((p) => p.remaining != null);
  const path = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join('');
  const step = Math.max(1, Math.ceil(b.points.length / 7));
  return (
    <ChartCard title="Sprint burndown" sub={`${b.sprint.name} · ${b.total} ${b.unit} in scope`} legend={[['Remaining', 'var(--series-1)'], ['Ideal', 'var(--chart-ink)', true]]}
      table={<table className="list-table"><thead><tr><th>Day</th><th>Ideal</th><th>Remaining</th></tr></thead><tbody>{b.points.map((p) => <tr key={p.day}><td>{fmtDate(p.day, locale)}</td><td>{p.ideal}</td><td>{p.remaining ?? '—'}</td></tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => { setTip(null); setHover(null); }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Burndown: ${actual.at(-1)?.remaining ?? b.total} of ${b.total} ${b.unit} remaining`}>
          <Axis max={max} />
          {b.points.map((p, i) => i % step === 0 && <text key={p.day} className="axis-x" x={x(i)} y={H - 8} textAnchor="middle">{fmtDate(p.day, locale)}</text>)}
          <path d={path(b.points.map((p, i) => [x(i), y(p.ideal)]))} className="line-ideal" />
          <path d={path(actual.map((p) => [x(b.points.indexOf(p)), y(p.remaining!)]))} className="line s1" />
          {hover != null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />}
          {actual.map((p) => { const i = b.points.indexOf(p); return <circle key={p.day} cx={x(i)} cy={y(p.remaining!)} r={hover === i ? 5 : 3.5} className="dot s1" />; })}
          {b.points.map((p, i) => (
            <rect key={p.day} x={x(i) - (W / n) / 2} y={PAD.t} width={W / n} height={H - PAD.t - PAD.b} fill="transparent"
              onMouseMove={(e) => { setHover(i); setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [fmtDate(p.day, locale), `Remaining: ${p.remaining ?? '—'}`, `Ideal: ${p.ideal}`] }); }} />
          ))}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

function Velocity({ data }: { data: ReportsData }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const v = data.velocity;
  if (!v.length) return <div className="content-card"><h3>Velocity</h3><Empty icon="trend" title="No completed sprints yet">Complete your first sprint and your team’s velocity will appear here.</Empty></div>;
  const max = niceMax(Math.max(...v.flatMap((s) => [s.committed, s.completed]), 1));
  const slot = (W - PAD.l - PAD.r) / v.length;
  const bw = Math.min(26, slot / 3);
  const y = (val: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - val / max);
  const avg = Math.round(v.reduce((a, s) => a + s.completed, 0) / v.length);
  return (
    <ChartCard title="Velocity" sub={`Average ${avg} points per sprint`} legend={[['Committed', 'var(--series-1)'], ['Completed', 'var(--series-2)']]}
      table={<table className="list-table"><thead><tr><th>Sprint</th><th>Committed</th><th>Completed</th></tr></thead><tbody>{v.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.committed}</td><td>{s.completed}</td></tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Velocity across ${v.length} sprints, average ${avg} points`}>
          <Axis max={max} />
          {v.map((s, i) => {
            const cx = PAD.l + slot * i + slot / 2;
            return (
              <g key={s.name}>
                {([['committed', s.committed, 's1', -bw - 1], ['completed', s.completed, 's2', 1]] as const).map(([k, val, cls, dx]) => (
                  <path key={k} className={`bar ${cls}`} d={barPath(cx + dx, y(val), bw, H - PAD.b)}
                    onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [s.name, `Committed: ${s.committed}`, `Completed: ${s.completed}`] })} />
                ))}
                <text className="axis-x" x={cx} y={H - 8} textAnchor="middle">{s.name.replace(/^.*Sprint\s*/i, 'S')}</text>
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

/** Bar with 4px rounded top, square at the baseline. */
function barPath(x: number, top: number, w: number, base: number) {
  const h = Math.max(0, base - top);
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

function Flow({ data }: { data: ReportsData }) {
  const { locale } = useWs();
  const [tip, setTip] = useState<Tip | null>(null);
  const max = niceMax(Math.max(...data.flow.flatMap((d) => [d.created, d.resolved]), 1));
  const slot = (W - PAD.l - PAD.r) / data.flow.length;
  const bw = Math.max(4, Math.min(12, slot / 2.6));
  const y = (val: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - val / max);
  const created = data.flow.reduce((a, d) => a + d.created, 0);
  const resolved = data.flow.reduce((a, d) => a + d.resolved, 0);
  return (
    <ChartCard title="Created vs resolved" sub={`Last 14 days · ${created} created, ${resolved} resolved`} legend={[['Created', 'var(--series-1)'], ['Resolved', 'var(--series-2)']]}
      table={<table className="list-table"><thead><tr><th>Day</th><th>Created</th><th>Resolved</th></tr></thead><tbody>{data.flow.map((d) => <tr key={d.day}><td>{fmtDate(d.day, locale)}</td><td>{d.created}</td><td>{d.resolved}</td></tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${created} created and ${resolved} resolved in 14 days`}>
          <Axis max={max} />
          {data.flow.map((d, i) => {
            const cx = PAD.l + slot * i + slot / 2;
            const show = () => (e: React.MouseEvent) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [fmtDate(d.day, locale), `Created: ${d.created}`, `Resolved: ${d.resolved}`] });
            return (
              <g key={d.day} onMouseMove={show()}>
                <rect x={cx - slot / 2} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
                {d.created > 0 && <path className="bar s1" d={barPath(cx - bw - 1, y(d.created), bw, H - PAD.b)} />}
                {d.resolved > 0 && <path className="bar s2" d={barPath(cx + 1, y(d.resolved), bw, H - PAD.b)} />}
                {i % 2 === 0 && <text className="axis-x" x={cx} y={H - 8} textAnchor="middle">{new Date(d.day + 'T12:00:00').getDate()}</text>}
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

function Workload({ data }: { data: ReportsData }) {
  const max = Math.max(...data.workload.map((w) => w.open), 1);
  return (
    <div className="content-card">
      <h3>Workload</h3>
      <p className="muted">Open work by person — spot who’s stretched</p>
      {data.workload.length ? data.workload.map((w) => (
        <div className="dist-row" key={w.userId ?? 'none'}>
          <div className="dist-top"><span>{w.name}</span><span>{w.open} open{w.points ? ` · ${w.points} pts` : ''}{w.overdue ? ` · ${w.overdue} overdue` : ''}</span></div>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${(w.open / max) * 100}%`, background: 'var(--series-1)' }} /></div>
        </div>
      )) : <Empty icon="people" title="No assigned work yet" />}
    </div>
  );
}

function StatusCard({ data }: { data: ReportsData }) {
  const total = data.byStatus.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className="content-card">
      <h3>Status breakdown</h3>
      <p className="muted">Where work sits in your workflow right now</p>
      <div className="stack-bar" role="img" aria-label={data.byStatus.map((s) => `${s.name} ${s.count}`).join(', ')}>
        {data.byStatus.filter((s) => s.count).map((s) => <i key={s.id} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.name}: ${s.count}`} />)}
      </div>
      {data.byStatus.map((s) => (
        <div className="legend-row" key={s.id}><span><i style={{ background: s.color }} />{s.name}</span><b>{s.count}</b><small>{Math.round((s.count / total) * 100)}%</small></div>
      ))}
      {data.byType.length > 0 && <p className="muted" style={{ marginTop: 14 }}>By type: {data.byType.map((t) => `${TYPE_LABEL[t.type]} ${t.count}`).join(' · ')}</p>}
    </div>
  );
}

function PriorityCard({ data }: { data: ReportsData }) {
  const total = data.byPriority.reduce((a, p) => a + p.count, 0);
  const colors = { urgent: '#e76f82', high: '#f3a47e', medium: '#8880ef', low: '#4dc0a9' };
  return (
    <div className="content-card">
      <h3>Priority mix</h3>
      <p className="muted">Live distribution from this project’s work</p>
      {data.byPriority.map((p) => (
        <div className="dist-row" key={p.priority}>
          <div className="dist-top"><span>{PRIORITY_LABEL[p.priority]}</span><span>{p.count} items · {total ? Math.round((p.count / total) * 100) : 0}%</span></div>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${total ? (p.count / total) * 100 : 0}%`, background: colors[p.priority] }} /></div>
        </div>
      ))}
    </div>
  );
}
