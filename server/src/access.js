import { HttpError, notFound } from './http.js';

/**
 * Access levels, lowest first:
 *  viewer  — read-only, on the projects they're a resource of
 *  member  — team member: comments, uploads, links, moves cards, on the projects they're on
 *  manager — sees every project; creates and edits cards, project details, dates and assignees
 *  admin   — everything, including people and roles
 */
export const RANK = { viewer: 0, member: 1, manager: 2, admin: 3 };
export const isManager = (role) => RANK[role] >= RANK.manager;

const DENIED = {
  admin: 'Only workspace admins can do that.',
  manager: 'Only managers and admins can do that. Ask an admin if you need it.',
  member: 'Viewers can look but not change things. Ask an admin for team member access.',
};

export function assertRole(membership, min) {
  if (!membership) throw notFound('Workspace');
  if (RANK[membership.role] < RANK[min]) throw new HttpError(403, DENIED[min] ?? DENIED.member);
}

/** Managers and admins see every project; everyone else only the projects they're a resource of. */
export async function canSeeProject(db, membership, projectId, userId) {
  if (isManager(membership.role)) return true;
  return !!await db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId);
}

/**
 * SQL condition: the project aliased `alias` is visible to the user. Takes two parameters: (userId, userId).
 * Use inside queries that already restrict to one workspace.
 */
export const VISIBLE_PROJECT = (alias = 'p') => `(EXISTS (SELECT 1 FROM memberships vm WHERE vm.workspace_id = ${alias}.workspace_id AND vm.user_id = ? AND vm.role IN ('admin','manager'))
  OR EXISTS (SELECT 1 FROM project_members vpm WHERE vpm.project_id = ${alias}.id AND vpm.user_id = ?))`;

export async function membershipFor(db, workspaceId, userId) {
  return await db.get('SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
}

/** Resolves a workspace by slug or id and checks the caller's role. */
export async function loadWorkspace(db, user, ref, min = 'viewer') {
  // Slug first: older workspaces named e.g. "2025" have an all-digit slug.
  const ws = await db.get('SELECT * FROM workspaces WHERE slug = ?', String(ref))
    ?? (/^\d+$/.test(String(ref)) ? await db.get('SELECT * FROM workspaces WHERE id = ?', Number(ref)) : undefined);
  if (!ws) throw notFound('Workspace');
  const membership = await membershipFor(db, ws.id, user.id);
  assertRole(membership, min);
  return { ws, membership };
}

export async function loadProject(db, user, projectId, min = 'viewer') {
  const project = await db.get('SELECT * FROM projects WHERE id = ?', Number(projectId));
  if (!project) throw notFound('Project');
  const membership = await membershipFor(db, project.workspace_id, user.id);
  if (!membership || !await canSeeProject(db, membership, project.id, user.id)) throw notFound('Project');
  assertRole(membership, min);
  return Object.assign(project, { viewerRole: membership.role });
}

/** Accepts a numeric id or a human key such as WEB-101 (scoped to the caller's workspaces). */
export async function loadIssue(db, user, ref, min = 'viewer') {
  let issue;
  const key = String(ref).match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
  if (key) {
    issue = await db.get(
      `SELECT i.* FROM issues i
         JOIN projects p ON p.id = i.project_id
         JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ?
        WHERE UPPER(p.key) = UPPER(?) AND i.number = ?`,
      user.id, key[1], Number(key[2]),
    );
  } else if (/^\d+$/.test(String(ref))) {
    issue = await db.get('SELECT * FROM issues WHERE id = ?', Number(ref));
  }
  if (!issue) throw notFound('Work item');
  const project = await loadProject(db, user, issue.project_id, min);
  return { issue, project };
}

/**
 * Locks a row until the surrounding transaction ends, so check-then-write
 * sequences (one active sprint, at least one admin…) can't race on Postgres.
 * SQLite transactions already run one at a time, so it's a no-op there.
 */
export async function lockRow(db, table, id) {
  if (!['workspaces', 'projects'].includes(table)) throw new Error(`lockRow: unexpected table ${table}`);
  if (db.dialect === 'postgres') await db.get(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`, id);
}
