import express, { Router } from 'express';
import { requireUser } from '../auth.js';
import { HttpError, notFound } from '../http.js';
import { loadIssue, loadProject } from '../access.js';
import { attachment as serializeAttachment } from '../serialize.js';

export const MAX_FILE_MB = 10;
const MAX_FILES_PER_ITEM = 50;
/** Shown in the page (previews); anything else downloads, so a file can never run script on our origin. */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'text/plain', 'video/mp4', 'audio/mpeg']);

const cleanName = (raw) => {
  let name = 'file';
  try { name = decodeURIComponent(String(raw || 'file')); } catch { name = String(raw || 'file'); }
  return name.replace(/[\\/\0\r\n]+/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || 'file';
};
const cleanMime = (raw) => (/^[\w.+-]+\/[\w.+-]+$/.test(String(raw).split(';')[0].trim()) ? String(raw).split(';')[0].trim().toLowerCase() : 'application/octet-stream');

/**
 * File attachments on work items. Files are stored in the database itself, so
 * they live wherever the data lives (SQLite file or Supabase) and keep working
 * after moving servers. Upload: the raw file as the request body, with its
 * name in X-File-Name.
 */
export function fileRoutes({ db, events }) {
  const r = Router();
  r.use(['/issues', '/attachments'], requireUser);

  r.post('/issues/:ref/attachments', express.raw({ type: () => true, limit: `${MAX_FILE_MB}mb` }), async (req, res) => {
    const { issue, project } = await loadIssue(db, req.user, req.params.ref, 'member');
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!data.length) throw new HttpError(400, 'That file is empty.');
    const count = (await db.get('SELECT COUNT(*) AS n FROM attachments WHERE issue_id = ?', issue.id)).n;
    if (count >= MAX_FILES_PER_ITEM) throw new HttpError(400, `A work item can hold up to ${MAX_FILES_PER_ITEM} files. Remove some first.`);
    const name = cleanName(req.get('X-File-Name'));
    const mime = cleanMime(req.get('Content-Type'));
    const { lastInsertRowid } = await db.run('INSERT INTO attachments (issue_id, name, mime, size, data, uploader_id) VALUES (?, ?, ?, ?, ?, ?)',
      issue.id, name, mime, data.length, data, req.user.id);
    await db.run("UPDATE issues SET updated_at = datetime('now') WHERE id = ?", issue.id);
    await events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: issue.id, actorId: req.user.id, verb: 'attached', data: { name } });
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`, 'issues'], req.user.id);
    res.status(201).json(serializeAttachment(await db.get(`${META} WHERE a.id = ?`, Number(lastInsertRowid))));
  });

  r.get('/attachments/:id', async (req, res) => {
    const row = await db.get('SELECT a.*, i.project_id FROM attachments a JOIN issues i ON i.id = a.issue_id WHERE a.id = ?', Number(req.params.id));
    if (!row) throw notFound('File');
    await loadProject(db, req.user, row.project_id);
    const inline = INLINE.has(row.mime) && req.query.download === undefined;
    res.setHeader('Content-Type', inline ? row.mime : 'application/octet-stream');
    res.setHeader('Content-Length', String(row.size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${row.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(row.name)}`);
    // Belt and braces: even if a browser tried to render it, it gets no script and no access to the app.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(row.data));
  });

  r.delete('/attachments/:id', async (req, res) => {
    const row = await db.get('SELECT a.id, a.name, a.uploader_id, a.issue_id FROM attachments a WHERE a.id = ?', Number(req.params.id));
    if (!row) throw notFound('File');
    const { issue, project } = await loadIssue(db, req.user, String(row.issue_id), 'member');
    const isAdmin = await db.get("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ? AND role = 'admin'", project.workspace_id, req.user.id);
    if (row.uploader_id !== req.user.id && !isAdmin) throw new HttpError(403, 'Only the person who added a file (or an admin) can remove it.');
    await db.run('DELETE FROM attachments WHERE id = ?', row.id);
    await events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: issue.id, actorId: req.user.id, verb: 'detached', data: { name: row.name } });
    events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`, 'issues'], req.user.id);
    res.json({ ok: true });
  });

  return r;
}

export const META = `SELECT a.id, a.issue_id, a.name, a.mime, a.size, a.uploader_id, a.created_at, u.name AS uploader_name
  FROM attachments a LEFT JOIN users u ON u.id = a.uploader_id`;
