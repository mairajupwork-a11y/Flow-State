import { ISSUE_SELECT, issue as serializeIssue } from '../serialize.js';
import { isoDay, dayOffset } from '../dates.js';

/**
 * Project automations: "when <trigger> [and the item matches <filter>] then
 * <actions>". Event triggers run inside the change that caused them; the
 * time-based ones (due soon, overdue) run from a scheduler and fire once per
 * item. Changes an automation makes never trigger further automations, so
 * rules can't loop.
 */
export const TRIGGERS = ['created', 'status', 'assigned', 'priority', 'comment', 'due_soon', 'overdue'];
export const ACTIONS = ['notify', 'assign', 'priority', 'label', 'move', 'comment', 'due'];
const TIMED = new Set(['due_soon', 'overdue']);

function matches(rule, event, patch, item) {
  const w = rule.when;
  switch (w.event) {
    case 'created': if (event !== 'created') return false; break;
    case 'status': if (!patch?.statusId || (w.statusId && w.statusId !== patch.statusId)) return false; break;
    case 'assigned': if (!patch?.assigneeId || (w.userId && w.userId !== patch.assigneeId)) return false; break;
    case 'priority': if (!patch?.priority || (w.priority && w.priority !== patch.priority)) return false; break;
    case 'comment': if (event !== 'comment') return false; break;
    case 'due_soon': case 'overdue': if (event !== w.event) return false; break;
    default: return false;
  }
  const f = w.filter ?? {};
  if (f.type && f.type !== item.type) return false;
  if (f.priority && f.priority !== item.priority) return false;
  if (f.label && !item.labels.map((l) => l.toLowerCase()).includes(String(f.label).toLowerCase())) return false;
  return true;
}

/** Plain-English reason used in notifications, e.g. "moved to Done". */
async function reason(db, rule, item) {
  const w = rule.when;
  if (w.event === 'created') return 'was created';
  if (w.event === 'status') return `moved to ${item.statusName}`;
  if (w.event === 'assigned') return 'was assigned';
  if (w.event === 'priority') return `is now ${item.priority} priority`;
  if (w.event === 'comment') return 'has a new comment';
  if (w.event === 'due_soon') return `is due ${item.dueDate === isoDay() ? 'today' : `on ${item.dueDate}`}`;
  if (w.event === 'overdue') return `is overdue (was due ${item.dueDate})`;
  return 'changed';
}

async function recipients(db, ids, item) {
  const out = [];
  for (const r of ids ?? []) {
    if (r === 'assignee') out.push(item.assigneeId);
    else if (r === 'reporter') out.push(item.reporterId);
    else if (r === 'watchers') out.push(...(await db.all('SELECT user_id FROM watchers WHERE issue_id = ?', item.id)).map((w) => w.user_id));
    else if (Number.isInteger(r)) out.push(r);
  }
  return out.filter(Boolean);
}

async function apply(db, { rule, project, item, actor, events }) {
  // Imported lazily: services/issues.js imports this module too.
  const { updateIssue } = await import('./issues.js');
  const key = `${project.key}-${item.number}`;
  const patch = {};
  for (const a of rule.then) {
    if (a.action === 'notify') {
      const to = await recipients(db, a.to, item);
      const why = await reason(db, rule, item);
      await events?.notify({ workspaceId: project.workspace_id, issueId: item.id, actorId: actor?.id ?? null, kind: 'automation', includeActor: true,
        recipients: to, text: `${a.message ? `${a.message} — ` : ''}${key} “${item.title}” ${why}` });
    } else if (a.action === 'assign') patch.assigneeId = a.userId === 'reporter' ? item.reporterId : a.userId ?? null;
    else if (a.action === 'priority') patch.priority = a.priority;
    else if (a.action === 'label') patch.labels = [...new Set([...(patch.labels ?? item.labels), a.label])];
    else if (a.action === 'move') patch.statusId = a.statusId;
    else if (a.action === 'due') patch.dueDate = dayOffset(Number(a.days) || 0);
    else if (a.action === 'comment' && a.text) {
      await db.run('INSERT INTO comments (issue_id, author_id, body) VALUES (?, ?, ?)', item.id, actor?.id ?? null, `🤖 ${a.text}`);
    }
  }
  if (Object.keys(patch).length) {
    // Only apply references that still exist (a column or person may have been removed since).
    if (patch.statusId && !await db.get('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', patch.statusId, project.id)) delete patch.statusId;
    if (patch.assigneeId && !await db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', project.workspace_id, patch.assigneeId)) delete patch.assigneeId;
    if (Object.keys(patch).length) {
      await updateIssue(db, { issueRow: await db.get('SELECT * FROM issues WHERE id = ?', item.id), project, actor: actor ?? { id: null, name: 'Automation' }, input: patch, events, automation: true });
    }
  }
  await db.run("UPDATE automations SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?", rule.id);
  await events?.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: item.id, actorId: actor?.id ?? null, verb: 'automation', data: { name: rule.name } });
}

const parse = (row) => ({ id: row.id, name: row.name, when: JSON.parse(row.when_json), then: JSON.parse(row.then_json) });

/** Runs the project's event rules that match this change. */
export async function runAutomations(db, { project, issueId, event, patch = null, actor, events }) {
  const rows = await db.all('SELECT * FROM automations WHERE project_id = ? AND enabled = 1 ORDER BY id', project.id);
  if (!rows.length) return 0;
  let ran = 0;
  for (const rule of rows.map(parse)) {
    if (TIMED.has(rule.when.event)) continue;
    const item = serializeIssue(await db.get(`${ISSUE_SELECT} WHERE i.id = ?`, issueId));
    if (!item || !matches(rule, event, patch, item)) continue;
    await apply(db, { rule, project, item, actor, events });
    ran++;
  }
  return ran;
}

/**
 * Time-based rules across every project: fires "due soon" / "overdue" once per
 * item (re-armed if the due date changes and it fires again later).
 */
export async function runScheduledAutomations(db, { events, today = isoDay() } = {}) {
  const rows = await db.all("SELECT a.*, p.workspace_id, p.key AS project_key FROM automations a JOIN projects p ON p.id = a.project_id WHERE a.enabled = 1 AND p.archived = 0");
  let ran = 0;
  for (const row of rows) {
    const rule = parse(row);
    if (!TIMED.has(rule.when.event)) continue;
    const project = await db.get('SELECT * FROM projects WHERE id = ?', row.project_id);
    const until = rule.when.event === 'overdue' ? null : dayOffset(Math.max(0, Number(rule.when.days ?? 1)), new Date(today + 'T00:00:00Z'));
    const items = rule.when.event === 'overdue'
      ? await db.all(`${ISSUE_SELECT} WHERE i.project_id = ? AND i.due_date IS NOT NULL AND i.due_date < ? AND s.category <> 'done'
          AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = ? AND r.issue_id = i.id)`, project.id, today, rule.id)
      : await db.all(`${ISSUE_SELECT} WHERE i.project_id = ? AND i.due_date IS NOT NULL AND i.due_date >= ? AND i.due_date <= ? AND s.category <> 'done'
          AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = ? AND r.issue_id = i.id)`, project.id, today, until, rule.id);
    const actor = row.created_by ? await db.get('SELECT * FROM users WHERE id = ?', row.created_by) : null;
    for (const raw of items) {
      const item = serializeIssue(raw);
      if (!matches(rule, rule.when.event, null, item)) continue;
      await db.tx(async () => {
        await db.run('INSERT OR IGNORE INTO automation_runs (automation_id, issue_id) VALUES (?, ?)', rule.id, item.id);
        await apply(db, { rule, project, item, actor, events });
      });
      ran++;
    }
  }
  return ran;
}

/** Clears the "already fired" marks for an item whose due date moved, so timed rules can fire again. */
export async function rearmTimed(db, issueId) {
  await db.run('DELETE FROM automation_runs WHERE issue_id = ?', issueId);
}
