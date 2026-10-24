import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, ErrorState, PageLoader } from '../../components/ui';
import { useReports } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PRIORITY_LABEL, fmtDate, todayISO } from '../../lib/format';
import { api } from '../../lib/api';
import { askConfirm, toast } from '../../lib/store';
import { methodologyOf, term, typeLabel, type MetricId, lower } from '../../lib/methodology';
import type { Reports as ReportsData } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

/*
 * Charts follow one system: series colours come from validated tokens
 * (--series-1..3, re-stepped for dark mode), every multi-series chart has a
 * legend, marks have hover tooltips, and each chart offers a table view.
 */

export default function Reports() {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const { data, error, refetch } = useReports(project.id);
  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!data) return <PageLoader />;
  const t = data.totals;
  return (
    <>
      <SectionBar title="Project insights" sub={`${m.name} metrics · live from your project data`} />
      <div className="metric-grid">
        <Stat label="Completion" value={`${t.total ? Math.round((t.done / t.total) * 100) : 0}%`} foot={`${t.done} of ${t.total} items done`} icon="checkcircle" tone={['#eaf3f2', '#448b82']} />
        <Stat label="In progress" value={t.inProgress} foot="Active right now" icon="loader" tone={['#f0f5f9', '#829fb9']} />
        <Stat label="Overdue" value={t.overdue} foot={t.overdue ? 'Need a new date or owner' : 'Nothing overdue'} icon="flag" tone={['#fdf1ef', '#ce876f']} />
        {m.phases
          ? <Stat label={`${term(m.id, 'phases')} passed`} value={`${data.phases.filter((p) => p.state === 'complete').length}/${data.phases.length}`} foot={data.phases.find((p) => p.state === 'active' || p.state === 'review')?.name ?? 'Lifecycle complete'} icon="layers" tone={['#f2dcd0', '#d2895f']} />
          : <Stat label={m.features.wip ? 'Cycle time (85%)' : 'Avg. cycle time'} value={fmtDays(m.features.wip ? data.cycle.p85 : t.cycleTimeDays)} foot={m.features.wip ? `85% of items finish within this` : 'Created → done, last 30 days'} icon="clock" tone={['#f2dcd0', '#d2895f']} />}
      </div>
      <MetricGrid data={data} />
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
  if (!b) return <div className="content-card"><h3>Burndown</h3><Empty icon="chart" title="Nothing running">Start a sprint or iteration from the backlog to see how work burns down day by day.</Empty></div>;
  const max = niceMax(b.total);
  const n = b.points.length - 1 || 1;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const actual = b.points.filter((p) => p.remaining != null);
  const path = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join('');
  const step = Math.max(1, Math.ceil(b.points.length / 7));
  return (
    <ChartCard title="Burndown" sub={`${b.sprint.name} · ${b.total} ${b.unit} in scope`} legend={[['Remaining', 'var(--series-1)'], ['Ideal', 'var(--chart-ink)', true]]}
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
                <text className="axis-x" x={cx} y={H - 8} textAnchor="middle">{s.name.replace(/^.*(Sprint|Iteration)\s*/i, '#')}</text>
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
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
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
      {data.byType.length > 0 && <p className="muted" style={{ marginTop: 14 }}>By type: {data.byType.map((t) => `${typeLabel(m, t.type)} ${t.count}`).join(' · ')}</p>}
    </div>
  );
}

function PriorityCard({ data }: { data: ReportsData }) {
  const total = data.byPriority.reduce((a, p) => a + p.count, 0);
  const colors = { urgent: '#b9563a', high: '#c97a44', medium: '#c58f2c', low: 'var(--series-2)' };
  return (
    <div className="content-card">
      <h3>Priority mix</h3>
      <p className="muted">Live distribution from this project’s work</p>
      {data.byPriority.map((p) => (
        <div className="dist-row" key={p.priority}>
          <div className="dist-top"><span>{PRIORITY_LABEL[p.priority]}</span><span>{p.count} {p.count === 1 ? 'item' : 'items'} · {total ? Math.round((p.count / total) * 100) : 0}%</span></div>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${total ? (p.count / total) * 100 : 0}%`, background: colors[p.priority] }} /></div>
        </div>
      ))}
    </div>
  );
}

const fmtDays = (d: number | null | undefined) => (d == null ? '—' : d < 1 ? '<1d' : `${d}d`);

/** Lays out the report cards a methodology calls for, two per row. */
function MetricGrid({ data }: { data: ReportsData }) {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const cards: Record<MetricId, () => ReactNode> = {
    burndown: () => <Burndown data={data} />,
    velocity: () => <Velocity data={data} />,
    flow: () => <Flow data={data} />,
    workload: () => <Workload data={data} />,
    status: () => <StatusCard data={data} />,
    priority: () => <PriorityCard data={data} />,
    cfd: () => <Cfd data={data} />,
    cycle: () => <CycleScatter data={data} />,
    throughput: () => <Throughput data={data} />,
    efficiency: () => <Efficiency data={data} />,
    phases: () => <PhaseProgress data={data} />,
    control: () => <ControlChart data={data} />,
  };
  const list = [...m.metrics];
  const rows: MetricId[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return (
    <>
      {rows.map((r) => (
        <div className={r.length > 1 ? 'two-col report-row' : 'report-row'} key={r.join('-')}>{r.map((id) => <div key={id} style={{ minWidth: 0 }}>{cards[id]()}</div>)}</div>
      ))}
      {data.registers.length > 0 && <RegisterSummary data={data} />}
    </>
  );
}

/** Cumulative flow diagram: stacked bands per column; widening bands reveal bottlenecks. */
function Cfd({ data }: { data: ReportsData }) {
  const { locale } = useWs();
  const [tip, setTip] = useState<Tip | null>(null);
  const { statuses, days } = data.cfd;
  const order = [...statuses].reverse(); // done at the bottom, as on a standard CFD
  const totals = days.map((d) => statuses.reduce((a, s) => a + (d.counts[s.name] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const n = days.length - 1 || 1;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const cum = days.map((d) => { let acc = 0; return order.map((s) => (acc += d.counts[s.name] ?? 0)); });
  const bands = order.map((s, k) => {
    const top = cum.map((c, i) => `${x(i)},${y(c[k])}`);
    const bottom = cum.map((c, i) => `${x(i)},${y(k ? c[k - 1] : 0)}`).reverse();
    return <polygon key={s.name} points={[...top, ...bottom].join(' ')} fill={s.color} fillOpacity={0.78} stroke={s.color} strokeWidth={1} />;
  });
  const last = days[days.length - 1];
  const step = Math.ceil(days.length / 6);
  return (
    <ChartCard title="Cumulative flow" sub="Last 30 days · parallel bands mean steady flow; a widening band is a bottleneck" legend={statuses.map((s) => [s.name, s.color] as [string, string])}
      table={<table className="list-table"><thead><tr><th>Day</th>{statuses.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{days.map((d) => <tr key={d.day}><td>{fmtDate(d.day, locale)}</td>{statuses.map((s) => <td key={s.name}>{d.counts[s.name] ?? 0}</td>)}</tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Cumulative flow. Today: ${statuses.map((s) => `${s.name} ${last?.counts[s.name] ?? 0}`).join(', ')}`}>
          <Axis max={max} />
          {bands}
          {days.map((d, i) => i % step === 0 && <text key={d.day} className="axis-x" x={x(i)} y={H - 8} textAnchor="middle">{fmtDate(d.day, locale)}</text>)}
          {days.map((d, i) => (
            <rect key={d.day} x={x(i) - (W / n) / 2} y={PAD.t} width={W / n} height={H - PAD.t - PAD.b} fill="transparent"
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [fmtDate(d.day, locale), ...statuses.map((s) => `${s.name}: ${d.counts[s.name] ?? 0}`)] })} />
          ))}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

/** Cycle-time scatter with 50th / 85th percentile lines (service level expectation). */
function CycleScatter({ data }: { data: ReportsData }) {
  const { locale } = useWs();
  const [tip, setTip] = useState<Tip | null>(null);
  const c = data.cycle;
  if (!c.samples.length) return <div className="content-card"><h3>Cycle time</h3><Empty icon="clock" title="No finished work yet">Cycle time appears once items reach the done column.</Empty></div>;
  const max = niceMax(Math.max(...c.samples.map((s) => s.cycle), c.p85 ?? 0, 1));
  const first = Date.parse(c.samples[0].resolved);
  const span = Math.max(1, Date.parse(c.samples[c.samples.length - 1].resolved) - first);
  const x = (d: string) => PAD.l + 8 + ((W - PAD.l - PAD.r - 16) * (Date.parse(d) - first)) / span;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <ChartCard title="Cycle time" sub={`Median ${fmtDays(c.p50)} · 85% within ${fmtDays(c.p85)} · lead time avg ${fmtDays(c.avgLead)}`} legend={[['Item', 'var(--series-1)'], ['85th percentile', '#d98d6e', true], ['Median', 'var(--chart-ink)', true]]}
      table={<table className="list-table"><thead><tr><th>Item</th><th>Done</th><th>Cycle (d)</th><th>Lead (d)</th></tr></thead><tbody>{c.samples.map((s) => <tr key={s.key}><td>{s.key} {s.title}</td><td>{fmtDate(s.resolved, locale)}</td><td>{s.cycle}</td><td>{s.lead}</td></tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Cycle time: median ${c.p50} days, 85th percentile ${c.p85} days`}>
          <Axis max={max} />
          {c.p85 != null && <line className="line-ideal" x1={PAD.l} x2={W - PAD.r} y1={y(c.p85)} y2={y(c.p85)} style={{ stroke: '#d98d6e' }} />}
          {c.p50 != null && <line className="line-ideal" x1={PAD.l} x2={W - PAD.r} y1={y(c.p50)} y2={y(c.p50)} />}
          {c.samples.map((s) => (
            <circle key={s.key} cx={x(s.resolved)} cy={y(s.cycle)} r={4.5} className="dot s1"
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [s.key, s.title, `Cycle ${s.cycle}d · lead ${s.lead}d`] })} />
          ))}
          <text className="axis-x" x={PAD.l} y={H - 8}>{fmtDate(c.samples[0].resolved, locale)}</text>
          <text className="axis-x" x={W - PAD.r} y={H - 8} textAnchor="end">{fmtDate(c.samples[c.samples.length - 1].resolved, locale)}</text>
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

function Throughput({ data }: { data: ReportsData }) {
  const { locale } = useWs();
  const [tip, setTip] = useState<Tip | null>(null);
  const t = data.throughput;
  const max = niceMax(Math.max(...t.map((w) => w.count), 1));
  const slot = (W - PAD.l - PAD.r) / t.length;
  const bw = Math.min(30, slot / 1.8);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const avg = Math.round((t.slice(-4).reduce((a, w) => a + w.count, 0) / 4) * 10) / 10;
  return (
    <ChartCard title="Throughput" sub={`Items finished per week · recent average ${avg}`}
      table={<table className="list-table"><thead><tr><th>Week of</th><th>Finished</th></tr></thead><tbody>{t.map((w) => <tr key={w.week}><td>{fmtDate(w.week, locale)}</td><td>{w.count}</td></tr>)}</tbody></table>}>
      <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Weekly throughput, recent average ${avg}`}>
          <Axis max={max} />
          {t.map((w, i) => {
            const cx = PAD.l + slot * i + slot / 2;
            return (
              <g key={w.week} onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [`Week of ${fmtDate(w.week, locale)}`, `${w.count} finished`] })}>
                <rect x={cx - slot / 2} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
                {w.count > 0 && <path className="bar s2" d={barPath(cx - bw / 2, y(w.count), bw, H - PAD.b)} />}
                <text className="axis-x" x={cx} y={H - 8} textAnchor="middle">{fmtDate(w.week, locale)}</text>
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </ChartCard>
  );
}

function Efficiency({ data }: { data: ReportsData }) {
  const e = data.efficiency;
  const pct = e.average ?? 0;
  return (
    <div className="content-card">
      <h3>Flow efficiency</h3>
      <p className="muted">Share of lead time spent actively working, not waiting. 15–40% is typical; higher is better.</p>
      <div className="efficiency">
        <div className="progress-ring" style={{ ['--p' as string]: `${pct}%` }}><strong>{e.average == null ? '—' : `${pct}%`}</strong></div>
        <div className="stack-8">
          <div className="legend-row"><span>Work in progress</span><b>{e.wip}</b></div>
          <div className="legend-row"><span>Lead time by Little’s law</span><b>{fmtDays(e.littleLeadDays)}</b></div>
          {e.byStatus.map((s) => <div className="legend-row" key={s.name}><span><i style={{ background: s.waiting ? '#e0b468' : 'var(--series-1)' }} />{s.name} <small className="muted">{s.waiting ? 'waiting' : 'active'}</small></span><b>{s.count}</b></div>)}
        </div>
      </div>
    </div>
  );
}

function PhaseProgress({ data }: { data: ReportsData }) {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const { locale } = useWs();
  return (
    <div className="content-card">
      <h3>{term(m.id, 'phases')} progress</h3>
      <p className="muted">Work completed in each {lower(term(m.id, 'phase'))} and its {m.features.phases === 'dmaic' ? 'tollgate' : 'gate'} date</p>
      {data.phases.map((p) => (
        <div className="dist-row" key={p.id}>
          <div className="dist-top">
            <span>{p.state === 'complete' ? '✓ ' : ''}{p.name}{p.late && <span className="phase-state late" style={{ marginLeft: 8 }}>Late</span>}</span>
            <span>{p.done}/{p.total} · {p.endDate ? fmtDate(p.endDate, locale) : 'no date'}</span>
          </div>
          <div className="dist-track"><div className="dist-fill" style={{ width: `${p.percent}%`, background: p.state === 'complete' ? 'var(--teal)' : p.late ? '#cf7e71' : 'var(--series-1)' }} /></div>
        </div>
      ))}
      {!data.phases.length && <Empty icon="layers" title="No phases" />}
    </div>
  );
}

/** Acklam's rational approximation of the inverse standard normal CDF. */
function invNorm(p: number) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  if (q > 1 - 0.02425) { const r = Math.sqrt(-2 * Math.log(1 - q)); return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  const r = q - 0.5;
  const t = r * r;
  return ((((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * r) / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
}

/** Six Sigma individuals (I-MR) control chart with spec limits, capability and a DPMO calculator. */
function ControlChart({ data }: { data: ReportsData }) {
  const { project } = useProjectCtx();
  const { locale, canEdit } = useWs();
  const qc = useQueryClient();
  const [tip, setTip] = useState<Tip | null>(null);
  const [form, setForm] = useState({ day: todayISO(), value: '', note: '' });
  const [dpmo, setDpmo] = useState({ defects: '', units: '', opportunities: '1' });
  const c = data.control;
  const charter = project.settings.charter ?? {};
  const add = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/measurements`, { day: form.day, value: Number(form.value), note: form.note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reports', project.id] }); setForm({ ...form, value: '', note: '' }); toast('Measurement added.'); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/projects/${project.id}/measurements/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', project.id] }) });
  const vals = c.points.map((p) => p.value);
  const lines = [c.ucl, c.lcl, c.mean, c.usl, c.lsl].filter((v): v is number => v != null);
  const lo = Math.min(...vals, ...lines);
  const hi = Math.max(...vals, ...lines);
  const pad = (hi - lo) * 0.12 || 1;
  const [min, max] = [lo - pad, hi + pad];
  const n = Math.max(1, c.points.length - 1);
  const x = (i: number) => PAD.l + 8 + ((W - PAD.l - PAD.r - 16) * i) / n;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / (max - min));
  const signal = new Set(c.signals.map((s) => s.index));
  const d = Number(dpmo.defects), u = Number(dpmo.units), o = Number(dpmo.opportunities) || 1;
  const dpmoValue = u > 0 ? (d / (u * o)) * 1e6 : null;
  const sigma = dpmoValue != null ? Math.round((invNorm(1 - dpmoValue / 1e6) + 1.5) * 100) / 100 : null;
  const unit = charter.unit ? ` ${charter.unit}` : '';

  return (
    <ChartCard title={`Control chart${charter.ctq ? ` · ${charter.ctq}` : ''}`} sub={c.mean == null ? 'Add measurements of your CTQ metric to plot the process' : `Mean ${c.mean}${unit} · UCL ${c.ucl} · LCL ${c.lcl} · σ ${c.sigma}${c.signals.length ? ` · ${c.signals.length} signal${c.signals.length === 1 ? '' : 's'}` : ' · in control'}`}
      legend={[['Measurement', 'var(--series-1)'], ['Mean', 'var(--chart-ink)', true], ['Control limits ±3σ', '#d98d6e', true], ...(c.usl != null || c.lsl != null ? [['Spec limits', '#cf7e71', true] as [string, string, boolean]] : [])]}
      table={<table className="list-table"><thead><tr><th>Day</th><th>Value</th><th>Note</th><th /></tr></thead><tbody>{c.points.map((p) => <tr key={p.id}><td>{fmtDate(p.day, locale)}</td><td>{p.value}</td><td>{p.note}</td><td>{canEdit && <button className="link-btn" onClick={async () => (await askConfirm({ title: 'Delete this measurement?', confirmLabel: 'Delete', danger: true })) && del.mutate(p.id)}>Delete</button>}</td></tr>)}</tbody></table>}>
      {c.points.length > 0 ? (
        <div className="chart-wrap" onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Control chart with ${c.points.length} measurements, mean ${c.mean}`}>
            {[c.ucl, c.lcl].map((v, k) => v != null && <g key={k}><line className="line-ideal" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} style={{ stroke: '#d98d6e' }} /><text className="axis-x" x={PAD.l - 4} y={y(v) + 3} textAnchor="end">{k ? 'LCL' : 'UCL'}</text></g>)}
            {[c.usl, c.lsl].map((v, k) => v != null && <g key={k}><line className="line-ideal" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} style={{ stroke: '#cf7e71' }} /><text className="axis-x" x={W - PAD.r} y={y(v) - 4} textAnchor="end">{k ? 'LSL' : 'USL'}</text></g>)}
            {c.mean != null && <g><line className="line-ideal" x1={PAD.l} x2={W - PAD.r} y1={y(c.mean)} y2={y(c.mean)} /><text className="axis-x" x={PAD.l - 4} y={y(c.mean) + 3} textAnchor="end">x̄</text></g>}
            <path className="line s1" d={c.points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('')} />
            {c.points.map((p, i) => (
              <circle key={p.id} cx={x(i)} cy={y(p.value)} r={signal.has(i) ? 5.5 : 3.5} className="dot s1" style={signal.has(i) ? { fill: '#cf7e71', stroke: '#cf7e71' } : undefined}
                onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, lines: [fmtDate(p.day, locale), `${p.value}${unit}`, ...(p.note ? [p.note] : []), ...c.signals.filter((s) => s.index === i).map((s) => `⚠ ${s.rule}`)] })} />
            ))}
          </svg>
          <Tooltip tip={tip} />
        </div>
      ) : <Empty icon="chart" title="No measurements yet">Record your CTQ metric over time to see whether the process is stable.</Empty>}

      <div className="control-foot">
        <div className="capability">
          <div><small>Cp</small><b>{c.cp ?? '—'}</b></div>
          <div><small>Cpk</small><b className={c.cpk != null ? (c.cpk >= 1.33 ? 'ok' : c.cpk >= 1 ? 'warn' : 'bad') : ''}>{c.cpk ?? '—'}</b></div>
          <div><small>Process sigma</small><b>{c.sigmaLevel ?? '—'}</b></div>
          {charter.target != null && charter.target !== '' && <div><small>Target</small><b>{String(charter.target)}{unit}</b></div>}
        </div>
        {c.cpk == null ? <p className="tiny-note">Set LSL / USL in the charter to calculate capability (Cpk ≥ 1.33 is capable).</p>
          : c.cp == null ? <p className="tiny-note">Add both LSL and USL in the charter to calculate Cp. Cpk ≥ 1.33 is capable.</p>
          : <p className="tiny-note">Cpk ≥ 1.33 is capable; below 1.0 the process produces out-of-spec results.</p>}
        {canEdit && (
          <form className="row-8 wrap measure-form" onSubmit={(e) => { e.preventDefault(); if (form.value !== '' && Number.isFinite(Number(form.value))) add.mutate(); }}>
            <input className="text-input slim" type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} aria-label="Measurement date" />
            <input className="text-input slim" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={`Value${unit}`} aria-label="Measured value" />
            <input className="text-input slim" value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note (optional)" aria-label="Note" />
            <button className="btn btn-soft btn-sm" disabled={add.isPending || form.value === ''}><Icon name="plus" size={13} /> Add measurement</button>
          </form>
        )}
        <details className="dpmo">
          <summary>Sigma level calculator (DPMO)</summary>
          <div className="row-8 wrap" style={{ marginTop: 10 }}>
            <label className="form-field compact"><span>Defects</span><input className="text-input slim" inputMode="numeric" value={dpmo.defects} onChange={(e) => setDpmo({ ...dpmo, defects: e.target.value })} /></label>
            <label className="form-field compact"><span>Units</span><input className="text-input slim" inputMode="numeric" value={dpmo.units} onChange={(e) => setDpmo({ ...dpmo, units: e.target.value })} /></label>
            <label className="form-field compact"><span>Opportunities / unit</span><input className="text-input slim" inputMode="numeric" value={dpmo.opportunities} onChange={(e) => setDpmo({ ...dpmo, opportunities: e.target.value })} /></label>
            <div className="capability"><div><small>DPMO</small><b>{dpmoValue == null ? '—' : Math.round(dpmoValue).toLocaleString(locale)}</b></div><div><small>Sigma level</small><b>{sigma ?? '—'}</b></div></div>
          </div>
          <p className="tiny-note">Includes the conventional 1.5σ long-term shift. 3.4 DPMO = 6σ.</p>
        </details>
      </div>
    </ChartCard>
  );
}

function RegisterSummary({ data }: { data: ReportsData }) {
  return (
    <div className="content-card report-row">
      <h3>Governance registers</h3>
      <p className="muted">Open entries and high-scoring risks across your logs</p>
      <div className="register-summary">
        {data.registers.map((r) => (
          <div key={r.kind} className="register-sum"><small>{r.label}</small><b>{r.open}</b><span>open of {r.total}{r.high ? ` · ${r.high} high` : ''}</span></div>
        ))}
      </div>
    </div>
  );
}
