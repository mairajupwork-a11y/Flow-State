import { PROJECT_COLORS } from '../templates.js';
import { methodology, legacyTemplate } from '../../../shared/methodologies.js';
import { dayOffset, isoDay } from '../dates.js';
import { HttpError } from '../http.js';

export function suggestKey(name) {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 4);
  return (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 6);
}

const PHASE_DAYS = 14;

/** Creates the methodology's phases; the first one starts active. */
export async function createPhases(db, projectId, m, { startOffset = 0 } = {}) {
  if (!m.phases) return [];
  const start = startOffset;
  const ids = [];
  for (const [i, ph] of m.phases.entries()) {
    const state = i === 0 ? 'active' : 'pending';
    const s = dayOffset(start + i * PHASE_DAYS);
    const e = dayOffset(start + (i + 1) * PHASE_DAYS - 1);
    ids.push(Number((await db.run(
      `INSERT INTO phases (project_id, name, position, state, gate, start_date, end_date, started_at, completed_at, decision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, ph.name, i, state, ph.gate, s, e,
      state !== 'pending' ? new Date().toISOString() : null, state === 'complete' ? new Date().toISOString() : null,
      state === 'complete' ? 'Approved — exit criteria met.' : '',
    )).lastInsertRowid));
  }
  return ids;
}

/**
 * Creates a project for a methodology: its workflow columns, phases/stages
 * and a first sprint or iteration where the practice requires one. Projects
 * start empty; no example work is added.
 */
export async function createProject(db, { workspaceId, actor, name, key, description = '', methodology: methodId, template, color }) {
  const id = methodId || template || 'scrum';
  const m = methodology(id);
  return await db.tx(async () => {
    const finalKey = (key || suggestKey(name)).toUpperCase();
    if (await db.get('SELECT 1 FROM projects WHERE workspace_id = ? AND key = ?', workspaceId, finalKey)) {
      throw new HttpError(409, `The key ${finalKey} is already used by another project. Try a different one.`);
    }
    const count = (await db.get('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?', workspaceId)).n;
    const { lastInsertRowid } = await db.run(
      'INSERT INTO projects (workspace_id, key, name, description, color, template, methodology, lead_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      workspaceId, finalKey, name, description, color || PROJECT_COLORS[count % PROJECT_COLORS.length], legacyTemplate(m.id), m.id, actor.id,
    );
    const projectId = Number(lastInsertRowid);
    for (const [position, [sName, category, sColor, wip]] of m.statuses.entries()) {
      await db.run('INSERT INTO statuses (project_id, name, category, color, position, wip_limit) VALUES (?, ?, ?, ?, ?, ?)',
        projectId, sName, category, sColor, position, wip ?? null);
    }
    await createPhases(db, projectId, m);

    if (m.features.sprints === 'required') {
      await db.run(
        "INSERT INTO sprints (project_id, name, goal, state, start_date, end_date) VALUES (?, ?, ?, 'active', ?, ?)",
        projectId, `${finalKey} ${m.terms.sprint ?? 'Sprint'} 1`, '', isoDay(), dayOffset(14),
      );
    }
    return await db.get('SELECT * FROM projects WHERE id = ?', projectId);
  });
}

