import { SAMPLE_WORK, SAMPLE_GOVERNANCE, PROJECT_COLORS } from '../templates.js';
import { methodology, legacyTemplate, REGISTERS } from '../../../shared/methodologies.js';
import { dayOffset, isoDay } from '../dates.js';
import { HttpError } from '../http.js';
import { createIssue } from './issues.js';

export function suggestKey(name) {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 4);
  return (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 6);
}

const PHASE_DAYS = 14;

/** Creates the methodology's phases. With samples, earlier phases look lived-in. */
export function createPhases(db, projectId, m, { withSamples = false, startOffset = 0 } = {}) {
  if (!m.phases) return [];
  const start = withSamples ? -PHASE_DAYS - 7 : startOffset;
  return m.phases.map((ph, i) => {
    const state = withSamples ? (i === 0 ? 'complete' : i === 1 ? 'active' : 'pending') : i === 0 ? 'active' : 'pending';
    const s = dayOffset(start + i * PHASE_DAYS);
    const e = dayOffset(start + (i + 1) * PHASE_DAYS - 1);
    return Number(db.run(
      `INSERT INTO phases (project_id, name, position, state, gate, start_date, end_date, started_at, completed_at, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, ph.name, i, state, ph.gate, s, e,
      state !== 'pending' ? new Date().toISOString() : null, state === 'complete' ? new Date().toISOString() : null,
      state === 'complete' ? 'Approved — exit criteria met.' : '',
    ).lastInsertRowid);
  });
}

/**
 * Creates a project for a methodology: its workflow columns, phases/stages,
 * a first sprint or iteration where the practice uses them, and optional
 * starter work, registers and charter so nobody faces an empty project.
 */
export function createProject(db, { workspaceId, actor, name, key, description = '', methodology: methodId, template, color, withSamples = false, memberIds = [] }) {
  const id = methodId || template || 'scrum';
  const m = methodology(id);
  return db.tx(() => {
    const finalKey = (key || suggestKey(name)).toUpperCase();
    if (db.get('SELECT 1 FROM projects WHERE workspace_id = ? AND key = ?', workspaceId, finalKey)) {
      throw new HttpError(409, `The key ${finalKey} is already used by another project. Try a different one.`);
    }
    const count = db.get('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?', workspaceId).n;
    const { lastInsertRowid } = db.run(
      'INSERT INTO projects (workspace_id, key, name, description, color, template, methodology, lead_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      workspaceId, finalKey, name, description, color || PROJECT_COLORS[count % PROJECT_COLORS.length], legacyTemplate(m.id), m.id, actor.id,
    );
    const projectId = Number(lastInsertRowid);
    const statusIds = m.statuses.map(([sName, category, sColor, wip], position) =>
      Number(db.run('INSERT INTO statuses (project_id, name, category, color, position, wip_limit) VALUES (?, ?, ?, ?, ?, ?)',
        projectId, sName, category, sColor, position, wip ?? null).lastInsertRowid));
    const phaseIds = createPhases(db, projectId, m, { withSamples });

    let sprintId = null;
    if (m.features.sprints === 'required' || (m.features.sprints === 'optional' && withSamples)) {
      sprintId = Number(db.run(
        "INSERT INTO sprints (project_id, name, goal, state, start_date, end_date) VALUES (?, ?, ?, 'active', ?, ?)",
        projectId, `${finalKey} ${m.terms.sprint ?? 'Sprint'} 1`, withSamples ? sampleGoal(m.id) : '', isoDay(), dayOffset(14),
      ).lastInsertRowid);
    }

    if (withSamples) seedSamples(db, { projectId, actor, m, statusIds, phaseIds, sprintId, people: memberIds.length ? memberIds : [actor.id] });
    return db.get('SELECT * FROM projects WHERE id = ?', projectId);
  });
}

/**
 * Spreads sample items over the last few weeks with a believable status
 * history so flow charts (CFD, cycle time, throughput) have something to show.
 */
function backdate(db, issueId, i, statusIdx, columns) {
  const created = new Date(Date.now() - (24 - (i * 5) % 22) * 864e5 - (i % 7) * 36e5);
  const iso = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
  const last = columns - 1;
  const idx = Math.min(statusIdx, last);
  const statuses = db.all('SELECT s.id, s.name FROM statuses s JOIN issues i ON i.project_id = s.project_id WHERE i.id = ? ORDER BY s.position', issueId);
  const row = db.get('SELECT project_id, i.reporter_id, p.workspace_id FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?', issueId);
  const span = Date.now() - created.getTime();
  // Walk the item from the first column to its current one at increasing times.
  let at = created.getTime();
  for (let k = 1; k <= idx; k++) {
    at += (span * (idx === last ? 0.9 : 0.8)) / Math.max(1, idx) * (k === 1 ? 0.6 : 1);
    db.run("INSERT INTO activity (workspace_id, project_id, issue_id, actor_id, verb, data, created_at) VALUES (?, ?, ?, ?, 'updated', ?, ?)",
      row.workspace_id, row.project_id, issueId, row.reporter_id, JSON.stringify({ field: 'statusId', from: statuses[k - 1].name, to: statuses[k].name }), iso(new Date(Math.min(at, Date.now() - 6e4))));
  }
  db.run('UPDATE issues SET created_at = ?, updated_at = ?, resolved_at = CASE WHEN resolved_at IS NULL THEN NULL ELSE ? END WHERE id = ?',
    iso(created), iso(new Date(Math.min(at, Date.now()))), new Date(Math.min(at, Date.now() - 6e4)).toISOString(), issueId);
}

const sampleGoal = (id) => (id === 'scrumban' ? 'Beta build in testers’ hands' : 'Ship a clearer first experience');

function seedSamples(db, { projectId, actor, m, statusIds, phaseIds, sprintId, people }) {
  let epicId = null;
  (SAMPLE_WORK[m.id] ?? []).forEach(([type, title, statusIdx, priority, label, due, estimate, checklist, desc, phaseIdx, inSprint], i) => {
    const issue = createIssue(db, {
      projectId, actor, silent: true,
      input: {
        type, title, description: desc ?? '', priority, labels: [label], statusId: statusIds[Math.min(statusIdx, statusIds.length - 1)],
        assigneeId: people[i % people.length],
        dueDate: due == null ? null : dayOffset(due),
        startDate: due == null ? null : dayOffset(type === 'milestone' ? due : due - 4 - (i % 3) * 2),
        storyPoints: estimate, sprintId: inSprint ? sprintId : null,
        epicId: type === 'epic' ? null : epicId,
        phaseId: phaseIdx != null ? phaseIds[phaseIdx] ?? null : null,
      },
    });
    if (type === 'epic') epicId = issue.id;
    backdate(db, issue.id, i, statusIdx, statusIds.length);
    checklist.forEach((text, idx) =>
      db.run('INSERT INTO checklist_items (issue_id, text, done, position) VALUES (?, ?, ?, ?)', issue.id, text,
        statusIdx >= statusIds.length - 1 || idx < Math.floor(checklist.length / 2) ? 1 : 0, idx));
  });

  const gov = SAMPLE_GOVERNANCE[m.id];
  if (!gov) return;
  if (gov.charter) db.run('UPDATE projects SET settings = ? WHERE id = ?', JSON.stringify({ charter: gov.charter }), projectId);
  (gov.entries ?? []).forEach(([kind, title, status, data], i) => {
    if (!REGISTERS[kind]) return;
    db.run('INSERT INTO entries (project_id, kind, title, status, owner_id, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      projectId, kind, title, status, people[i % people.length], JSON.stringify(data), actor.id);
  });
  (gov.measurements ?? []).forEach((value, i, all) =>
    db.run('INSERT INTO measurements (project_id, day, value) VALUES (?, ?, ?)', projectId, dayOffset((i - all.length + 1) * 7), value));
}
