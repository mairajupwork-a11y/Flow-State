import { TEMPLATES, SAMPLE_WORK, PROJECT_COLORS } from '../templates.js';
import { dayOffset, isoDay } from '../dates.js';
import { HttpError } from '../http.js';
import { createIssue } from './issues.js';

export function suggestKey(name) {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 4);
  return (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 6);
}

/**
 * Creates a project with its workflow statuses, a first sprint for Scrum,
 * and optional starter work so the board is never empty on day one.
 */
export function createProject(db, { workspaceId, actor, name, key, description = '', template = 'scrum', color, withSamples = false, memberIds = [] }) {
  return db.tx(() => {
    const finalKey = (key || suggestKey(name)).toUpperCase();
    if (db.get('SELECT 1 FROM projects WHERE workspace_id = ? AND key = ?', workspaceId, finalKey)) {
      throw new HttpError(409, `The key ${finalKey} is already used by another project. Try a different one.`);
    }
    const count = db.get('SELECT COUNT(*) AS n FROM projects WHERE workspace_id = ?', workspaceId).n;
    const { lastInsertRowid: projectId } = db.run(
      'INSERT INTO projects (workspace_id, key, name, description, color, template, lead_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      workspaceId, finalKey, name, description, color || PROJECT_COLORS[count % PROJECT_COLORS.length], template, actor.id,
    );
    const statusIds = TEMPLATES[template].statuses.map(([sName, category, sColor, wip], position) =>
      Number(db.run('INSERT INTO statuses (project_id, name, category, color, position, wip_limit) VALUES (?, ?, ?, ?, ?, ?)',
        projectId, sName, category, sColor, position, wip ?? null).lastInsertRowid));

    let sprintId = null;
    if (template === 'scrum') {
      sprintId = Number(db.run(
        "INSERT INTO sprints (project_id, name, goal, state, start_date, end_date) VALUES (?, ?, ?, 'active', ?, ?)",
        projectId, `${finalKey} Sprint 1`, withSamples ? 'Ship a clearer first experience' : '', isoDay(), dayOffset(14),
      ).lastInsertRowid);
    }

    if (withSamples) {
      const people = memberIds.length ? memberIds : [actor.id];
      let epicId = null;
      SAMPLE_WORK[template].forEach(([type, title, statusIdx, priority, label, due, points, checklist, desc], i) => {
        const issue = createIssue(db, {
          projectId: Number(projectId), actor, silent: true,
          input: {
            type, title, description: desc, priority, labels: [label], statusId: statusIds[statusIdx],
            assigneeId: people[i % people.length], dueDate: dayOffset(due), startDate: dayOffset(due - 4 - (i % 3) * 2),
            storyPoints: points, sprintId: type === 'epic' ? null : sprintId, epicId: type === 'epic' ? null : epicId,
          },
        });
        if (type === 'epic') epicId = issue.id;
        checklist.forEach((text, idx) =>
          db.run('INSERT INTO checklist_items (issue_id, text, done, position) VALUES (?, ?, ?, ?)', issue.id, text,
            statusIdx === 3 || idx < Math.floor(checklist.length / 2) ? 1 : 0, idx));
      });
      if (template === 'scrum') {
        // A couple of items waiting in the backlog makes sprint planning tangible.
        ['Finalise SEO page structure', 'Prototype responsive dashboard'].forEach((title, i) =>
          createIssue(db, { projectId: Number(projectId), actor, silent: true,
            input: { type: 'task', title, priority: i ? 'high' : 'low', labels: [i ? 'Design' : 'Content'], statusId: statusIds[0], storyPoints: i ? 5 : 2, epicId } }));
      }
    }
    return db.get('SELECT * FROM projects WHERE id = ?', projectId);
  });
}
