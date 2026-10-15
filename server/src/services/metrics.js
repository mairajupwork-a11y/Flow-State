import { isoDay, dayOffset } from '../dates.js';

/**
 * Methodology metrics built from the activity log: cumulative flow,
 * cycle/lead time, throughput, flow efficiency, phase progress and an
 * individuals (I-MR) control chart for Six Sigma measurements.
 */

const ts = (s) => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
/** Waiting columns: work sits there without anyone touching it. */
const WAITING = /review|wait|block|ready|selected|approval|authorised|queue|test/i;

/** Per-issue timeline of [time, statusName] built from status-change activity. */
function histories(db, projectId, issues) {
  const changes = db.all(
    "SELECT issue_id, data, created_at FROM activity WHERE project_id = ? AND verb = 'updated' AND data LIKE '%\"field\":\"statusId\"%' ORDER BY id",
    projectId,
  );
  const byIssue = new Map();
  for (const c of changes) {
    const d = JSON.parse(c.data);
    if (!byIssue.has(c.issue_id)) byIssue.set(c.issue_id, []);
    byIssue.get(c.issue_id).push({ at: ts(c.created_at), from: d.from, to: d.to });
  }
  return new Map(issues.map((i) => {
    const list = byIssue.get(i.id) ?? [];
    const start = list.length ? list[0].from : i.statusName;
    return [i.id, [{ at: ts(i.createdAt), name: start }, ...list.map((c) => ({ at: c.at, name: c.to }))]];
  }));
}

export function flowMetrics(db, p, issues, statuses) {
  const today = isoDay();
  const categoryOf = new Map(statuses.map((s) => [s.name, s.category]));
  const work = issues.filter((i) => i.type !== 'epic' && i.type !== 'milestone' && !i.parentId);
  const hist = histories(db, p.id, work);

  // Status at the end of a given day, falling back to resolved dates for items without history.
  const statusAt = (i, endMs) => {
    if (ts(i.createdAt) > endMs) return null;
    const h = hist.get(i.id);
    let name = h[0].name;
    for (const step of h) if (step.at <= endMs) name = step.name;
    if (h.length === 1) {
      if (i.resolvedAt && ts(i.resolvedAt) <= endMs) return statuses.find((s) => s.category === 'done')?.name ?? name;
      if (i.statusCategory === 'done') return statuses.find((s) => s.category === 'progress')?.name ?? name;
    }
    return name;
  };

  const days = Array.from({ length: 30 }, (_, k) => dayOffset(k - 29));
  const cfd = {
    statuses: statuses.map((s) => ({ name: s.name, color: s.color, category: s.category })),
    days: days.map((day) => {
      const end = Date.parse(day + 'T23:59:59Z');
      const counts = Object.fromEntries(statuses.map((s) => [s.name, 0]));
      for (const i of work) {
        const n = statusAt(i, end);
        if (n != null && n in counts) counts[n] += 1;
      }
      return { day, counts };
    }),
  };

  // Cycle time = first entry into a "progress" column → resolved. Lead time = created → resolved.
  const done = work.filter((i) => i.resolvedAt);
  const samples = done.map((i) => {
    const h = hist.get(i.id);
    const started = h.find((s) => categoryOf.get(s.name) === 'progress')?.at ?? (h.length === 1 ? null : ts(i.createdAt));
    const end = ts(i.resolvedAt);
    const lead = (end - ts(i.createdAt)) / 864e5;
    const cycle = started != null ? (end - started) / 864e5 : lead * 0.6;
    // Flow efficiency: share of the lead time spent in active (non-waiting) progress columns.
    let active = 0;
    h.forEach((s, k) => {
      const until = Math.min(h[k + 1]?.at ?? end, end);
      if (categoryOf.get(s.name) === 'progress' && !WAITING.test(s.name)) active += Math.max(0, until - s.at);
    });
    const efficiency = h.length > 1 && end > ts(i.createdAt) ? active / (end - ts(i.createdAt)) : null;
    return { key: i.key, title: i.title, resolved: i.resolvedAt.slice(0, 10), cycle: Math.max(0, cycle), lead: Math.max(0, lead), efficiency };
  }).sort((a, b) => a.resolved.localeCompare(b.resolved));

  const pct = (arr, q) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  };
  const cycles = samples.map((s) => s.cycle);
  const leads = samples.map((s) => s.lead);
  const effs = samples.map((s) => s.efficiency).filter((e) => e != null);
  const cycle = {
    samples: samples.slice(-40).map((s) => ({ ...s, cycle: round(s.cycle), lead: round(s.lead), efficiency: round(s.efficiency, 2) })),
    avgCycle: round(cycles.reduce((a, b) => a + b, 0) / (cycles.length || NaN)),
    p50: round(pct(cycles, 0.5)), p85: round(pct(cycles, 0.85)),
    avgLead: round(leads.reduce((a, b) => a + b, 0) / (leads.length || NaN)),
  };

  const throughput = Array.from({ length: 8 }, (_, k) => {
    const from = dayOffset(-7 * (8 - k) + 1);
    const to = dayOffset(-7 * (7 - k));
    return { week: from, count: done.filter((i) => i.resolvedAt.slice(0, 10) >= from && i.resolvedAt.slice(0, 10) <= to).length };
  });

  const wip = work.filter((i) => i.statusCategory === 'progress').length;
  const weekly = throughput.slice(-4).reduce((a, w) => a + w.count, 0) / 4;
  const efficiency = {
    average: effs.length ? round((effs.reduce((a, b) => a + b, 0) / effs.length) * 100, 0) : null,
    wip,
    // Little's law: average lead time ≈ WIP ÷ throughput.
    littleLeadDays: weekly ? round((wip / weekly) * 7) : null,
    byStatus: statuses.filter((s) => s.category === 'progress').map((s) => ({ name: s.name, waiting: WAITING.test(s.name), count: work.filter((i) => i.statusName === s.name).length })),
  };
  return { cfd, cycle, throughput, efficiency, today };
}

export function phaseMetrics(db, p, issues) {
  const phases = db.all('SELECT * FROM phases WHERE project_id = ? ORDER BY position', p.id);
  const today = isoDay();
  return phases.map((ph) => {
    const list = issues.filter((i) => i.phaseId === ph.id && i.type !== 'epic');
    const doneCount = list.filter((i) => i.statusCategory === 'done').length;
    return {
      id: ph.id, name: ph.name, state: ph.state, startDate: ph.start_date, endDate: ph.end_date, total: list.length, done: doneCount,
      percent: list.length ? Math.round((doneCount / list.length) * 100) : ph.state === 'complete' ? 100 : 0,
      late: ph.state !== 'complete' && ph.end_date != null && ph.end_date < today,
    };
  });
}

/** Individuals chart: σ estimated from the average moving range (MR̄ / 1.128). */
export function controlChart(db, p, charter = {}) {
  const points = db.all('SELECT * FROM measurements WHERE project_id = ? ORDER BY day, id', p.id);
  const values = points.map((m) => m.value);
  if (!values.length) return { points: [], mean: null, ucl: null, lcl: null, sigma: null, cp: null, cpk: null, sigmaLevel: null, signals: [] };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mr = values.slice(1).map((v, k) => Math.abs(v - values[k]));
  const sigma = mr.length ? mr.reduce((a, b) => a + b, 0) / mr.length / 1.128 : 0;
  const ucl = mean + 3 * sigma;
  const lcl = mean - 3 * sigma;
  const lsl = Number.isFinite(Number(charter.lsl)) && charter.lsl !== '' && charter.lsl != null ? Number(charter.lsl) : null;
  const usl = Number.isFinite(Number(charter.usl)) && charter.usl !== '' && charter.usl != null ? Number(charter.usl) : null;
  const cp = sigma && lsl != null && usl != null ? (usl - lsl) / (6 * sigma) : null;
  const cpkParts = [usl != null ? (usl - mean) / (3 * sigma) : null, lsl != null ? (mean - lsl) / (3 * sigma) : null].filter((x) => x != null);
  const cpk = sigma && cpkParts.length ? Math.min(...cpkParts) : null;
  // Western Electric rule 1 (beyond 3σ) and rule 4 (8 in a row on one side).
  const signals = [];
  values.forEach((v, k) => { if (sigma && (v > ucl || v < lcl)) signals.push({ index: k, rule: 'Outside control limits' }); });
  for (let k = 7; k < values.length; k++) {
    const run = values.slice(k - 7, k + 1);
    if (run.every((v) => v > mean) || run.every((v) => v < mean)) signals.push({ index: k, rule: '8 points on one side of the mean' });
  }
  return {
    points: points.map((m) => ({ id: m.id, day: m.day, value: m.value, note: m.note })),
    mean: round(mean, 2), ucl: round(ucl, 2), lcl: round(lcl, 2), sigma: round(sigma, 3), lsl, usl,
    cp: round(cp, 2), cpk: round(cpk, 2), sigmaLevel: cpk != null ? round(cpk * 3 + 1.5, 1) : null, signals,
  };
}
