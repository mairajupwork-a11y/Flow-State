import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadIssue } from '../access.js';
import { issue as serializeIssue } from '../serialize.js';
import { updateIssue, moveIssue, issueDetail, issueKey } from '../services/issues.js';
import { ISO_DATE } from '../dates.js';

const nullableId = z.number().int().positive().nullable();
const nullableDate = z.string().regex(ISO_DATE, 'use a YYYY-MM-DD date').nullable();

export const issueInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000),
  type: z.enum(['epic', 'feature', 'story', 'task', 'bug', 'subtask', 'milestone']),
  statusId: z.number().int().positive(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
  assigneeId: nullableId,
  sprintId: nullableId,
  epicId: nullableId,
  parentId: nullableId,
  phaseId: nullableId,
  storyPoints: z.number().int().min(0).max(999).nullable(),
  startDate: nullableDate,
  dueDate: nullableDate,
  labels: z.array(z.string().max(30)).max(12),
}).partial();

export function issueRoutes({ db, events }) {
  const r = Router();
  r.use(requireUser);

  r.get('/:ref', (req, res) => {
    const { issue } = loadIssue(db, req.user, req.params.ref);
    res.json(issueDetail(db, issue.id));
  });

  r.patch('/:ref', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const input = parse(issueInput, req.body);
    if (input.dueDate && input.startDate && input.startDate > input.dueDate) throw new HttpError(400, 'The start date needs to be before the due date.');
    const row = updateIssue(db, { issueRow: issue, project, actor: req.user, input, events });
    res.json(serializeIssue(row));
  });

  r.post('/:ref/move', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const body = parse(z.object({ statusId: z.number().int().positive().optional(), sprintId: nullableId.optional(), beforeId: nullableId.optional(), afterId: nullableId.optional() }), req.body);
    const row = moveIssue(db, { issueRow: issue, project, actor: req.user, ...body, events });
    res.json(serializeIssue(row));
  });

  r.delete('/:ref', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    db.run('DELETE FROM issues WHERE id = ?', issue.id);
    events.record({ workspaceId: project.workspace_id, projectId: project.id, actorId: req.user.id, verb: 'deleted', data: { key: `${project.key}-${issue.number}`, title: issue.title } });
    events.changed(project.workspace_id, ['issues', `project:${project.id}`], req.user.id);
    res.json({ ok: true });
  });

  // ---- Comments with @mentions ----
  r.post('/:ref/comments', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const { body } = parse(z.object({ body: z.string().trim().min(1, 'write something first').max(5000) }), req.body);
    const key = `${project.key}-${issue.number}`;
    db.tx(() => {
      db.run('INSERT INTO comments (issue_id, author_id, body) VALUES (?, ?, ?)', issue.id, req.user.id, body);
      db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', issue.id, req.user.id);
      db.run("UPDATE issues SET updated_at = datetime('now') WHERE id = ?", issue.id);
      events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: issue.id, actorId: req.user.id, verb: 'commented', data: { excerpt: body.slice(0, 140) } });
      const members = db.all('SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ?', project.workspace_id);
      const mentioned = members.filter((m) => new RegExp(`@${escapeRegex(m.name.split(' ')[0])}\\b`, 'i').test(body)).map((m) => m.id);
      events.notify({ workspaceId: project.workspace_id, issueId: issue.id, actorId: req.user.id, kind: 'mention', recipients: mentioned, text: `${req.user.name} mentioned you on ${key}: “${body.slice(0, 90)}”` });
      const watchers = db.all('SELECT user_id FROM watchers WHERE issue_id = ?', issue.id).map((w) => w.user_id).filter((id) => !mentioned.includes(id));
      events.notify({ workspaceId: project.workspace_id, issueId: issue.id, actorId: req.user.id, kind: 'comment', recipients: watchers, text: `${req.user.name} commented on ${key}: “${body.slice(0, 90)}”` });
    });
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`, 'issues'], req.user.id);
    res.status(201).json(issueDetail(db, issue.id));
  });

  r.patch('/:ref/comments/:commentId', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const comment = db.get('SELECT * FROM comments WHERE id = ? AND issue_id = ?', Number(req.params.commentId), issue.id);
    if (!comment) throw notFound('Comment');
    if (comment.author_id !== req.user.id) throw new HttpError(403, 'You can only edit your own comments.');
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(5000) }), req.body);
    db.run("UPDATE comments SET body = ?, edited_at = datetime('now') WHERE id = ?", body, comment.id);
    events.changed(project.workspace_id, [`issue:${issue.id}`], req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  r.delete('/:ref/comments/:commentId', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const comment = db.get('SELECT * FROM comments WHERE id = ? AND issue_id = ?', Number(req.params.commentId), issue.id);
    if (!comment) throw notFound('Comment');
    const isAdmin = db.get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND role = 'admin'", project.workspace_id, req.user.id);
    if (comment.author_id !== req.user.id && !isAdmin) throw new HttpError(403, 'You can only delete your own comments.');
    db.run('DELETE FROM comments WHERE id = ?', comment.id);
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`], req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  // ---- Checklist ----
  r.post('/:ref/checklist', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(200) }), req.body);
    const pos = db.get('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM checklist_items WHERE issue_id = ?', issue.id).p;
    db.run('INSERT INTO checklist_items (issue_id, text, position) VALUES (?, ?, ?)', issue.id, text, pos);
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`], req.user.id);
    res.status(201).json(issueDetail(db, issue.id));
  });

  r.patch('/:ref/checklist/:itemId', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const body = parse(z.object({ text: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() }), req.body);
    const item = db.get('SELECT * FROM checklist_items WHERE id = ? AND issue_id = ?', Number(req.params.itemId), issue.id);
    if (!item) throw notFound('Checklist item');
    if (body.text !== undefined) db.run('UPDATE checklist_items SET text = ? WHERE id = ?', body.text, item.id);
    if (body.done !== undefined) db.run('UPDATE checklist_items SET done = ? WHERE id = ?', Number(body.done), item.id);
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`], req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  r.delete('/:ref/checklist/:itemId', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    db.run('DELETE FROM checklist_items WHERE id = ? AND issue_id = ?', Number(req.params.itemId), issue.id);
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`], req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  // ---- Links & watching ----
  r.post('/:ref/links', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    const body = parse(z.object({ target: z.string().trim().min(1), kind: z.enum(['blocks', 'is_blocked_by', 'relates', 'duplicates']) }), req.body);
    const { issue: target, project: targetProject } = loadIssue(db, req.user, body.target);
    if (targetProject.workspace_id !== project.workspace_id) throw new HttpError(400, 'Links must stay within the same workspace.');
    if (target.id === issue.id) throw new HttpError(400, 'A work item cannot link to itself.');
    const [src, dst, kind] = body.kind === 'is_blocked_by' ? [target.id, issue.id, 'blocks'] : [issue.id, target.id, body.kind];
    db.run('INSERT OR IGNORE INTO issue_links (source_id, target_id, kind) VALUES (?, ?, ?)', src, dst, kind);
    events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: issue.id, actorId: req.user.id, verb: 'linked', data: { kind: body.kind, target: issueKey(db, target.id) } });
    events.changed(project.workspace_id, [`issue:${issue.id}`, `issue:${target.id}`], req.user.id);
    res.status(201).json(issueDetail(db, issue.id));
  });

  r.delete('/:ref/links/:linkId', (req, res) => {
    const { issue, project } = loadIssue(db, req.user, req.params.ref, 'member');
    db.run('DELETE FROM issue_links WHERE id = ? AND (source_id = ? OR target_id = ?)', Number(req.params.linkId), issue.id, issue.id);
    events.changed(project.workspace_id, [`issue:${issue.id}`], req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  r.post('/:ref/watch', (req, res) => {
    const { issue } = loadIssue(db, req.user, req.params.ref);
    const { watching } = parse(z.object({ watching: z.boolean() }), req.body);
    if (watching) db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', issue.id, req.user.id);
    else db.run('DELETE FROM watchers WHERE issue_id = ? AND user_id = ?', issue.id, req.user.id);
    res.json(issueDetail(db, issue.id));
  });

  return r;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
