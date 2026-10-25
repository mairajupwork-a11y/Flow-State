import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadProject, loadIssue } from '../access.js';
import { customField as serializeField, automation as serializeAutomation } from '../serialize.js';
import { FIELD_TYPES, readFieldValue, writeFieldValue } from '../services/fields.js';
import { TRIGGERS, ACTIONS } from '../services/automations.js';

const id = z.number().int().positive();
const options = z.array(z.string().trim().min(1).max(60)).max(50);

const when = z.object({
  event: z.enum(TRIGGERS),
  statusId: id.optional(),
  userId: id.optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  days: z.number().int().min(0).max(30).optional(),
  filter: z.object({
    type: z.string().max(20).optional(),
    priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
    label: z.string().trim().max(30).optional(),
  }).optional(),
});
const action = z.object({
  action: z.enum(ACTIONS),
  to: z.array(z.union([id, z.enum(['assignee', 'reporter', 'watchers'])])).max(20).optional(),
  message: z.string().trim().max(200).optional(),
  userId: z.union([id, z.literal('reporter')]).nullable().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  label: z.string().trim().min(1).max(30).optional(),
  statusId: id.optional(),
  text: z.string().trim().min(1).max(1000).optional(),
  days: z.number().int().min(0).max(365).optional(),
}).superRefine((a, ctx) => {
  const need = { notify: 'to', assign: 'userId', priority: 'priority', label: 'label', move: 'statusId', comment: 'text', due: 'days' }[a.action];
  if (a[need] === undefined || (need === 'to' && !a.to?.length)) ctx.addIssue({ code: 'custom', message: `the “${a.action}” action needs ${need === 'to' ? 'at least one person to notify' : `a ${need}`}` });
});
const automationInput = z.object({ name: z.string().trim().min(1).max(80), when, then: z.array(action).min(1).max(5), enabled: z.boolean().default(true) });

/** Custom fields and automations, both configured per project. */
export function extensionRoutes({ db, events }) {
  const r = Router();
  r.use(['/projects', '/issues'], requireUser);

  // ---- Custom fields ----
  r.get('/projects/:id/fields', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id);
    res.json((await db.all('SELECT * FROM custom_fields WHERE project_id = ? ORDER BY position, id', p.id)).map(serializeField));
  });

  r.post('/projects/:id/fields', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({ name: z.string().trim().min(1, 'give the field a name').max(40), type: z.enum(FIELD_TYPES), options: options.default([]) }), req.body);
    if (['select', 'multiselect'].includes(body.type) && !body.options.length) throw new HttpError(400, 'Add at least one option to choose from.');
    if ((await db.get('SELECT COUNT(*) AS n FROM custom_fields WHERE project_id = ?', p.id)).n >= 30) throw new HttpError(400, 'A project can have up to 30 custom fields.');
    if (await db.get('SELECT 1 FROM custom_fields WHERE project_id = ? AND LOWER(name) = LOWER(?)', p.id, body.name)) throw new HttpError(409, `There is already a field called “${body.name}”.`);
    const pos = (await db.get('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM custom_fields WHERE project_id = ?', p.id)).n;
    const { lastInsertRowid } = await db.run('INSERT INTO custom_fields (project_id, name, type, options, position) VALUES (?, ?, ?, ?, ?)',
      p.id, body.name, body.type, JSON.stringify([...new Set(body.options)]), pos);
    events.changed(p.workspace_id, [`project:${p.id}`, 'fields'], req.user.id);
    res.status(201).json(serializeField(await db.get('SELECT * FROM custom_fields WHERE id = ?', Number(lastInsertRowid))));
  });

  const loadField = async (req, min = 'member') => {
    const p = await loadProject(db, req.user, req.params.id, min);
    const f = await db.get('SELECT * FROM custom_fields WHERE id = ? AND project_id = ?', Number(req.params.fieldId), p.id);
    if (!f) throw notFound('Field');
    return { p, f };
  };

  r.patch('/projects/:id/fields/:fieldId', async (req, res) => {
    const { p, f } = await loadField(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), options: options.optional(), position: z.number().int().min(0).optional() }), req.body);
    if (body.name !== undefined) await db.run('UPDATE custom_fields SET name = ? WHERE id = ?', body.name, f.id);
    if (body.position !== undefined) await db.run('UPDATE custom_fields SET position = ? WHERE id = ?', body.position, f.id);
    if (body.options !== undefined) {
      if (['select', 'multiselect'].includes(f.type) && !body.options.length) throw new HttpError(400, 'Keep at least one option.');
      await db.run('UPDATE custom_fields SET options = ? WHERE id = ?', JSON.stringify([...new Set(body.options)]), f.id);
    }
    events.changed(p.workspace_id, [`project:${p.id}`, 'fields', 'issue'], req.user.id);
    res.json(serializeField(await db.get('SELECT * FROM custom_fields WHERE id = ?', f.id)));
  });

  r.delete('/projects/:id/fields/:fieldId', async (req, res) => {
    const { p, f } = await loadField(req);
    await db.run('DELETE FROM custom_fields WHERE id = ?', f.id);
    events.changed(p.workspace_id, [`project:${p.id}`, 'fields', 'issue'], req.user.id);
    res.json({ ok: true });
  });

  r.put('/issues/:ref/fields/:fieldId', async (req, res) => {
    const { issue, project } = await loadIssue(db, req.user, req.params.ref, 'member');
    const f = await db.get('SELECT * FROM custom_fields WHERE id = ? AND project_id = ?', Number(req.params.fieldId), project.id);
    if (!f) throw notFound('Field');
    const field = serializeField(f);
    const value = await writeFieldValue(db, field, req.body?.value, project.workspace_id);
    const prev = await db.get('SELECT value FROM issue_field_values WHERE issue_id = ? AND field_id = ?', issue.id, f.id);
    if (value === null) await db.run('DELETE FROM issue_field_values WHERE issue_id = ? AND field_id = ?', issue.id, f.id);
    else await db.run('INSERT INTO issue_field_values (issue_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT (issue_id, field_id) DO UPDATE SET value = excluded.value', issue.id, f.id, value);
    if ((prev?.value ?? null) !== value) {
      await db.run("UPDATE issues SET updated_at = datetime('now') WHERE id = ?", issue.id);
      const show = async (raw) => {
        if (raw == null) return null;
        const v = readFieldValue(field, raw);
        if (field.type === 'person') return (await db.get('SELECT name FROM users WHERE id = ?', v))?.name ?? null;
        return Array.isArray(v) ? v.join(', ') : String(v);
      };
      await events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: issue.id, actorId: req.user.id, verb: 'updated',
        data: { field: 'custom', name: field.name, from: await show(prev?.value), to: await show(value) } });
      events.changed(project.workspace_id, [`issue:${issue.id}`, `project:${project.id}`], req.user.id);
    }
    res.json({ fieldId: f.id, value: value === null ? null : readFieldValue(field, value) });
  });

  // ---- Automations ----
  const checkRefs = async (p, body) => {
    const statusIds = [body.when.statusId, ...body.then.map((a) => a.statusId)].filter(Boolean);
    for (const s of statusIds) if (!await db.get('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', s, p.id)) throw new HttpError(400, 'That column does not belong to this project.');
    const people = [body.when.userId, ...body.then.flatMap((a) => [a.userId, ...(a.to ?? [])])].filter((v) => Number.isInteger(v));
    for (const u of people) if (!await db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', p.workspace_id, u)) throw new HttpError(400, 'Everyone in a rule must be a workspace member.');
  };

  r.get('/projects/:id/automations', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id);
    res.json((await db.all('SELECT * FROM automations WHERE project_id = ? ORDER BY id', p.id)).map(serializeAutomation));
  });

  r.post('/projects/:id/automations', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'member');
    const body = parse(automationInput, req.body);
    await checkRefs(p, body);
    if ((await db.get('SELECT COUNT(*) AS n FROM automations WHERE project_id = ?', p.id)).n >= 50) throw new HttpError(400, 'A project can have up to 50 automations.');
    const { lastInsertRowid } = await db.run('INSERT INTO automations (project_id, name, when_json, then_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      p.id, body.name, JSON.stringify(body.when), JSON.stringify(body.then), Number(body.enabled), req.user.id);
    events.changed(p.workspace_id, [`project:${p.id}`, 'automations'], req.user.id);
    res.status(201).json(serializeAutomation(await db.get('SELECT * FROM automations WHERE id = ?', Number(lastInsertRowid))));
  });

  r.patch('/projects/:id/automations/:ruleId', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'member');
    const rule = await db.get('SELECT * FROM automations WHERE id = ? AND project_id = ?', Number(req.params.ruleId), p.id);
    if (!rule) throw notFound('Automation');
    const body = parse(automationInput.partial(), req.body);
    const merged = { when: body.when ?? JSON.parse(rule.when_json), then: body.then ?? JSON.parse(rule.then_json) };
    await checkRefs(p, merged);
    await db.run('UPDATE automations SET name = ?, when_json = ?, then_json = ?, enabled = ? WHERE id = ?',
      body.name ?? rule.name, JSON.stringify(merged.when), JSON.stringify(merged.then), body.enabled === undefined ? rule.enabled : Number(body.enabled), rule.id);
    if (body.when) await db.run('DELETE FROM automation_runs WHERE automation_id = ?', rule.id);
    events.changed(p.workspace_id, [`project:${p.id}`, 'automations'], req.user.id);
    res.json(serializeAutomation(await db.get('SELECT * FROM automations WHERE id = ?', rule.id)));
  });

  r.delete('/projects/:id/automations/:ruleId', async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'member');
    await db.run('DELETE FROM automations WHERE id = ? AND project_id = ?', Number(req.params.ruleId), p.id);
    events.changed(p.workspace_id, [`project:${p.id}`, 'automations'], req.user.id);
    res.json({ ok: true });
  });

  return r;
}
