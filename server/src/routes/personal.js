import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { parse, notFound } from '../http.js';
import { loadWorkspace, loadIssue } from '../access.js';
import { todo as serializeTodo, notification as serializeNotification } from '../serialize.js';
import { ISO_DATE, isoDay } from '../dates.js';

const TODO_SELECT = `SELECT t.*, p.key || '-' || i.number AS issue_key FROM todos t
  LEFT JOIN issues i ON i.id = t.issue_id LEFT JOIN projects p ON p.id = i.project_id`;

/** Private daily to-do list ("My day"). Owned by the user, not the workspace. */
export function todoRoutes({ db }) {
  const r = Router();
  r.use(requireUser);
  const day = z.string().regex(ISO_DATE);
  const block = z.enum(['morning', 'afternoon', 'evening', 'anytime']);

  r.get('/', (req, res) => {
    const d = parse(day.optional(), req.query.day) ?? isoDay();
    // Unfinished items from earlier days roll forward so nothing silently disappears.
    const rows = db.all(`${TODO_SELECT} WHERE t.user_id = ? AND (t.day = ? OR (t.day < ? AND t.done = 0)) ORDER BY t.done, t.important DESC, t.position`, req.user.id, d, d);
    const history = db.all(
      "SELECT day, COUNT(*) AS total, SUM(done) AS done FROM todos WHERE user_id = ? AND day >= date(?, '-6 days') AND day <= ? GROUP BY day ORDER BY day",
      req.user.id, d, d,
    );
    res.json({ day: d, items: rows.map(serializeTodo), history });
  });

  r.post('/', (req, res) => {
    const body = parse(z.object({
      text: z.string().trim().min(1, 'write a to-do first').max(200),
      day: day.optional(), timeBlock: block.default('anytime'), important: z.boolean().default(false),
      issueRef: z.string().optional(), note: z.string().max(1000).default(''),
    }), req.body);
    let issueId = null;
    if (body.issueRef) issueId = loadIssue(db, req.user, body.issueRef).issue.id;
    const pos = (db.get('SELECT MIN(position) AS p FROM todos WHERE user_id = ?', req.user.id).p ?? 1024) - 1;
    const { lastInsertRowid } = db.run(
      'INSERT INTO todos (user_id, text, note, day, time_block, important, issue_id, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      req.user.id, body.text, body.note, body.day ?? isoDay(), body.timeBlock, Number(body.important), issueId, pos,
    );
    res.status(201).json(serializeTodo(db.get(`${TODO_SELECT} WHERE t.id = ?`, lastInsertRowid)));
  });

  r.patch('/:id', (req, res) => {
    const t = db.get('SELECT * FROM todos WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!t) throw notFound('To-do');
    const body = parse(z.object({
      text: z.string().trim().min(1).max(200).optional(), note: z.string().max(1000).optional(), done: z.boolean().optional(),
      important: z.boolean().optional(), day: day.optional(), timeBlock: block.optional(), position: z.number().optional(),
    }), req.body);
    const cols = { text: 'text', note: 'note', important: 'important', day: 'day', timeBlock: 'time_block', position: 'position' };
    for (const [k, col] of Object.entries(cols)) if (body[k] !== undefined) db.run(`UPDATE todos SET ${col} = ? WHERE id = ?`, typeof body[k] === 'boolean' ? Number(body[k]) : body[k], t.id);
    if (body.done !== undefined) {
      // Completing a rolled-over item records it against today.
      db.run('UPDATE todos SET done = ?, completed_at = ?, day = CASE WHEN ? = 1 AND day < ? THEN ? ELSE day END WHERE id = ?',
        Number(body.done), body.done ? new Date().toISOString() : null, Number(body.done), isoDay(), isoDay(), t.id);
    }
    res.json(serializeTodo(db.get(`${TODO_SELECT} WHERE t.id = ?`, t.id)));
  });

  r.delete('/:id', (req, res) => {
    db.run('DELETE FROM todos WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  r.post('/clear-completed', (req, res) => {
    db.run('DELETE FROM todos WHERE user_id = ? AND done = 1 AND day = ?', req.user.id, parse(day.optional(), req.body?.day) ?? isoDay());
    res.json({ ok: true });
  });

  return r;
}

export function notificationRoutes({ db }) {
  const r = Router();
  r.use(requireUser);

  r.get('/:ws', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const rows = db.all(
      `SELECT n.*, u.name AS actor_name, u.color AS actor_color, p.key || '-' || i.number AS issue_key
         FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
         LEFT JOIN issues i ON i.id = n.issue_id LEFT JOIN projects p ON p.id = i.project_id
        WHERE n.user_id = ? AND n.workspace_id = ? ORDER BY n.id DESC LIMIT 50`,
      req.user.id, ws.id,
    );
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND workspace_id = ? AND read = 0', req.user.id, ws.id).n;
    res.json({ unread, items: rows.map(serializeNotification) });
  });

  r.post('/:ws/read', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const { ids } = parse(z.object({ ids: z.array(z.number().int()).optional() }), req.body ?? {});
    if (ids?.length) db.run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ws.id, ...ids);
    else db.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND workspace_id = ?', req.user.id, ws.id);
    res.json({ ok: true });
  });

  return r;
}
