/**
 * Bulk import from Jira, Trello, Asana, ClickUp or any spreadsheet. The browser
 * reads the file and maps columns; this turns each row into a work item,
 * matching statuses, priorities, types, people and dates as best it can.
 */
import { methodology } from '../../../shared/methodologies.js';
import { createIssue } from './issues.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

export function mapPriority(v) {
  const s = norm(v);
  if (!s) return undefined;
  if (/(highest|blocker|critical|urgent|p0|^1$)/.test(s)) return 'urgent';
  if (/(high|major|p1|^2$|important)/.test(s)) return 'high';
  if (/(lowest|trivial|minor|low|p3|p4|^4$|^5$)/.test(s)) return 'low';
  if (/(medium|normal|moderate|p2|^3$)/.test(s)) return 'medium';
  return undefined;
}

export function mapType(v, allowed) {
  const s = norm(v);
  let t = 'task';
  if (/(bug|defect|incident|error)/.test(s)) t = 'bug';
  else if (/epic/.test(s)) t = 'epic';
  else if (/(story|user story)/.test(s)) t = 'story';
  else if (/feature|improvement|enhancement/.test(s)) t = 'feature';
  else if (/milestone/.test(s)) t = 'milestone';
  if (allowed.includes(t)) return t;
  return allowed.includes('task') ? 'task' : allowed[0];
}

/** The project's column with the same name, else one of the right kind (done / in progress / to do). */
export function mapStatus(v, statuses) {
  const s = norm(v);
  const exact = statuses.find((st) => norm(st.name) === s);
  if (exact) return exact.id;
  const category = /(done|closed|resolved|complete|shipped|released|fixed|won't|wont|cancel)/.test(s) ? 'done'
    : /(progress|doing|review|testing|qa|develop|active|started|wip|blocked)/.test(s) ? 'progress' : 'todo';
  const byCat = statuses.find((st) => st.category === category);
  if (category === 'progress' && /(review|qa|test)/.test(s)) return (statuses.find((st) => /review|qa|test/i.test(st.name)) ?? byCat ?? statuses[0]).id;
  return (byCat ?? statuses[0]).id;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined);
/** Reads 2026-03-12, 2026-03-12T10:00Z, 12/Mar/26 10:00 AM (Jira), 03/12/2026, 12.03.2026, "Mar 12, 2026". */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/ -]([A-Za-z]{3})[A-Za-z]*[/ -](\d{2,4})/))) return valid(m[3].length === 2 ? `20${m[3]}` : m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/))) return valid(m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/))) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    // 13/03/2026 can only be day-first; otherwise read the US order (month/day) for slashes and day-first for dots.
    const [a, b] = [+m[1], +m[2]];
    if (a > 12) return valid(y, b, a);
    return s.includes('.') ? valid(y, b, a) : valid(y, a, b);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

export async function importRows(db, { project, actor, rows, events }) {
  const m = methodology(project.methodology);
  const statuses = await db.all('SELECT * FROM statuses WHERE project_id = ? ORDER BY position', project.id);
  const people = await db.all("SELECT u.id, u.name, u.email FROM users u JOIN memberships ms ON ms.user_id = u.id WHERE ms.workspace_id = ? AND ms.role <> 'viewer'", project.workspace_id);
  const findPerson = (v) => {
    const parts = String(v ?? '').split(/[,;]/).map((x) => norm(x)).filter(Boolean);
    const ids = [];
    for (const p of parts) {
      const hit = people.find((u) => norm(u.email) === p) ?? people.find((u) => norm(u.name) === p) ?? people.find((u) => norm(u.name).split(' ')[0] === p.split(' ')[0] && p.length > 2);
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    return ids;
  };
  const created = [];
  const skipped = [];
  const unmatchedPeople = new Set();
  for (const [index, row] of rows.entries()) {
    const title = String(row.title ?? '').trim().slice(0, 200);
    if (!title) { skipped.push({ row: index + 1, reason: 'No title' }); continue; }
    const assigneeIds = row.assignee ? findPerson(row.assignee) : [];
    if (row.assignee && !assigneeIds.length) unmatchedPeople.add(String(row.assignee).trim());
    const labels = (Array.isArray(row.labels) ? row.labels : String(row.labels ?? '').split(/[,;]|\s{2,}/)).map((l) => String(l).trim().slice(0, 30)).filter(Boolean).slice(0, 12);
    const points = row.storyPoints === undefined || row.storyPoints === '' ? null : Math.round(Number(row.storyPoints));
    let description = String(row.description ?? '').slice(0, 19_000);
    if (row.key) description = `${description}${description ? '\n\n' : ''}Imported from ${String(row.key).slice(0, 40)}`;
    let startDate = parseDate(row.startDate) ?? null;
    const dueDate = parseDate(row.dueDate) ?? null;
    if (startDate && dueDate && startDate > dueDate) startDate = null;
    try {
      const issue = await createIssue(db, {
        projectId: project.id, actor, silent: true,
        input: {
          title, description, type: mapType(row.type, m.types.filter((t) => t !== 'subtask')), priority: mapPriority(row.priority) ?? 'medium',
          statusId: row.status ? mapStatus(row.status, statuses) : statuses[0].id, assigneeIds, labels,
          storyPoints: Number.isFinite(points) && points >= 0 && points <= 999 ? points : null, startDate, dueDate,
        },
      });
      created.push(issue.id);
    } catch (err) {
      skipped.push({ row: index + 1, reason: err.message });
    }
  }
  if (created.length && events) {
    await events.record({ workspaceId: project.workspace_id, projectId: project.id, actorId: actor.id, verb: 'imported', data: { count: created.length, name: project.name } });
    events.changed(project.workspace_id, ['issues', `project:${project.id}`], actor.id);
  }
  return { created: created.length, skipped, unmatchedPeople: [...unmatchedPeople].slice(0, 20) };
}
