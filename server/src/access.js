import { HttpError, notFound } from './http.js';

const RANK = { viewer: 0, member: 1, admin: 2 };

function assertRole(membership, min) {
  if (!membership) throw notFound('Workspace');
  if (RANK[membership.role] < RANK[min]) {
    throw new HttpError(403, min === 'admin' ? 'Only workspace admins can do that.' : 'Viewers can look but not change things. Ask an admin for member access.');
  }
}

export function membershipFor(db, workspaceId, userId) {
  return db.get('SELECT * FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
}

/** Resolves a workspace by slug or id and checks the caller's role. */
export function loadWorkspace(db, user, ref, min = 'viewer') {
  const ws = /^\d+$/.test(String(ref))
    ? db.get('SELECT * FROM workspaces WHERE id = ?', Number(ref))
    : db.get('SELECT * FROM workspaces WHERE slug = ?', String(ref));
  if (!ws) throw notFound('Workspace');
  const membership = membershipFor(db, ws.id, user.id);
  assertRole(membership, min);
  return { ws, membership };
}

export function loadProject(db, user, projectId, min = 'viewer') {
  const project = db.get('SELECT * FROM projects WHERE id = ?', Number(projectId));
  if (!project) throw notFound('Project');
  assertRole(membershipFor(db, project.workspace_id, user.id), min);
  return project;
}

/** Accepts a numeric id or a human key such as WEB-101 (scoped to the caller's workspaces). */
export function loadIssue(db, user, ref, min = 'viewer') {
  let issue;
  const key = String(ref).match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
  if (key) {
    issue = db.get(
      `SELECT i.* FROM issues i
         JOIN projects p ON p.id = i.project_id
         JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ?
        WHERE p.key = ? COLLATE NOCASE AND i.number = ?`,
      user.id, key[1], Number(key[2]),
    );
  } else if (/^\d+$/.test(String(ref))) {
    issue = db.get('SELECT * FROM issues WHERE id = ?', Number(ref));
  }
  if (!issue) throw notFound('Work item');
  const project = loadProject(db, user, issue.project_id, min);
  return { issue, project };
}
