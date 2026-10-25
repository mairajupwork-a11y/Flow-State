import { SAMPLE_WORK, SAMPLE_GOVERNANCE } from '../templates.js';

/**
 * One-time removal of the example work earlier versions seeded into new
 * projects. An item counts as a sample only if its exact title is in a sample
 * set, it is among the first items numbered in its project (samples were
 * created with the project), and the project holds at least three items from
 * that same set, so work someone added themselves is left alone. Register
 * entries, charters, measurements and sprint goals that came with the samples
 * go too. Plain SQL that runs on both SQLite and Postgres.
 */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = (xs) => xs.map(q).join(', ');
const first = (alias) => `(SELECT MIN(f.number) FROM issues f WHERE f.project_id = ${alias}.project_id)`;

function sampleIssueWhere() {
  return Object.values(SAMPLE_WORK).map((rows) => {
    const titles = list(rows.map((r) => r[1]));
    const early = (a) => `${a}.title IN (${titles}) AND ${a}.number < ${first(a)} + ${rows.length}`;
    return `(${early('i')} AND (SELECT COUNT(*) FROM issues g WHERE g.project_id = i.project_id AND ${early('g')}) >= ${Math.min(3, rows.length)})`;
  }).join(' OR ');
}

export function removeSamplesSql() {
  const where = sampleIssueWhere();
  const projects = `SELECT DISTINCT i.project_id FROM issues i WHERE ${where}`;
  const out = [];
  for (const gov of Object.values(SAMPLE_GOVERNANCE)) {
    if (gov.measurements) out.push(`DELETE FROM measurements WHERE project_id IN (${projects}) AND value IN (${gov.measurements.join(', ')});`);
    for (const [kind, title] of gov.entries ?? []) out.push(`DELETE FROM entries WHERE project_id IN (${projects}) AND kind = ${q(kind)} AND title = ${q(title)};`);
    if (gov.charter) out.push(`UPDATE projects SET settings = '{}' WHERE settings = ${q(JSON.stringify({ charter: gov.charter }))};`);
  }
  out.push(`UPDATE sprints SET goal = '' WHERE project_id IN (${projects}) AND goal IN (${list(['Beta build in testers’ hands', 'Ship a clearer first experience'])});`);
  out.push(`DELETE FROM issues WHERE id IN (SELECT i.id FROM issues i WHERE ${where});`);
  return out.join('\n');
}
