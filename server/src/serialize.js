/** Row -> API shape converters. Keep the wire format camelCase and stable. */
import { NO_PASSWORD } from './auth.js';

export const initials = (name) =>
  String(name).trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

export function user(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, initials: initials(u.name), color: u.color, jobTitle: u.job_title };
}

export function me(u) {
  return { ...user(u), locale: u.locale, theme: u.theme, hasPassword: u.password_hash !== NO_PASSWORD };
}

export function workspace(w, role) {
  return {
    id: w.id, name: w.name, slug: w.slug, region: w.region, locale: w.locale, weekStart: w.week_start,
    teamSize: w.team_size, useCase: w.use_case, role, createdAt: w.created_at,
  };
}

export function project(p, extra = {}) {
  return {
    id: p.id, workspaceId: p.workspace_id, key: p.key, name: p.name, description: p.description, color: p.color,
    template: p.template, methodology: p.methodology ?? p.template, settings: parseJson(p.settings, {}), leadId: p.lead_id, archived: !!p.archived, createdAt: p.created_at, ...extra,
  };
}

const parseJson = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

export function phase(ph) {
  return {
    id: ph.id, projectId: ph.project_id, name: ph.name, position: ph.position, state: ph.state, gate: ph.gate, decision: ph.decision,
    startDate: ph.start_date, endDate: ph.end_date, startedAt: ph.started_at, completedAt: ph.completed_at, approvedBy: ph.approved_by,
  };
}

export function entry(e) {
  return {
    id: e.id, projectId: e.project_id, kind: e.kind, title: e.title, status: e.status, ownerId: e.owner_id,
    data: parseJson(e.data, {}), createdBy: e.created_by, createdAt: e.created_at, updatedAt: e.updated_at,
  };
}

export function measurement(m) {
  return { id: m.id, projectId: m.project_id, day: m.day, value: m.value, note: m.note, createdAt: m.created_at };
}

export function status(s) {
  return { id: s.id, name: s.name, category: s.category, color: s.color, position: s.position, wipLimit: s.wip_limit };
}

export function sprint(s) {
  return {
    id: s.id, projectId: s.project_id, name: s.name, goal: s.goal, state: s.state, startDate: s.start_date,
    endDate: s.end_date, completedAt: s.completed_at, committedPoints: s.committed_points, completedPoints: s.completed_points,
  };
}

/** Issue rows are expected to be selected via ISSUE_SELECT so derived columns are present. */
export function issue(i) {
  return {
    id: i.id, key: `${i.project_key}-${i.number}`, number: i.number, projectId: i.project_id, type: i.type, title: i.title,
    description: i.description, statusId: i.status_id, statusName: i.status_name, statusCategory: i.status_category,
    priority: i.priority, assigneeId: i.assignee_id, reporterId: i.reporter_id, sprintId: i.sprint_id, epicId: i.epic_id,
    parentId: i.parent_id, phaseId: i.phase_id ?? null, storyPoints: i.story_points, startDate: i.start_date, dueDate: i.due_date,
    labels: JSON.parse(i.labels || '[]'), rank: i.rank, createdAt: i.created_at, updatedAt: i.updated_at, resolvedAt: i.resolved_at,
    checklistTotal: i.checklist_total ?? 0, checklistDone: i.checklist_done ?? 0, commentCount: i.comment_count ?? 0,
    subtaskCount: i.subtask_count ?? 0,
  };
}

export const ISSUE_SELECT = `
  SELECT i.*, p.key AS project_key, s.name AS status_name, s.category AS status_category,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.issue_id = i.id) AS checklist_total,
    (SELECT COUNT(*) FROM checklist_items c WHERE c.issue_id = i.id AND c.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM comments c WHERE c.issue_id = i.id) AS comment_count,
    (SELECT COUNT(*) FROM issues k WHERE k.parent_id = i.id) AS subtask_count
  FROM issues i
  JOIN projects p ON p.id = i.project_id
  JOIN statuses s ON s.id = i.status_id`;

export function todo(t) {
  return {
    id: t.id, text: t.text, note: t.note, done: !!t.done, important: !!t.important, day: t.day, timeBlock: t.time_block,
    issueId: t.issue_id, issueKey: t.issue_key ?? null, position: t.position, createdAt: t.created_at, completedAt: t.completed_at,
  };
}

export function notification(n) {
  return {
    id: n.id, kind: n.kind, text: n.text, read: !!n.read, createdAt: n.created_at, issueId: n.issue_id,
    issueKey: n.issue_key ?? null, actor: n.actor_name ? { name: n.actor_name, color: n.actor_color, initials: initials(n.actor_name) } : null,
  };
}

export function activity(a) {
  return {
    id: a.id, verb: a.verb, data: JSON.parse(a.data || '{}'), createdAt: a.created_at, actorId: a.actor_id,
    issueId: a.issue_id, issueKey: a.issue_key ?? null, issueTitle: a.issue_title ?? null,
  };
}
