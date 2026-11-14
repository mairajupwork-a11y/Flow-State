import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { parse } from '../http.js';
import { loadWorkspace, canSeeProject, isManager } from '../access.js';

export function aiRoutes({ db, guide }) {
  const r = Router();
  r.use(requireUser);
  r.post('/:ws/ask', async (req, res) => {
    const { ws, membership } = await loadWorkspace(db, req.user, req.params.ws);
    const body = parse(z.object({ question: z.string().trim().min(1, 'ask me something').max(600), projectId: z.number().int().positive().nullable().optional() }), req.body);
    const projectId = body.projectId && await canSeeProject(db, membership, body.projectId, req.user.id) ? body.projectId : null;
    const answer = await guide.ask({ user: req.user, ws, projectId, question: body.question });
    // Only managers and admins create work items, so don't offer buttons that would only fail.
    if (!isManager(membership.role) && answer.actions?.some((a) => a.type === 'create_issue')) {
      answer.actions = answer.actions.filter((a) => a.type !== 'create_issue');
      answer.text = `${answer.text}\n\nNew work items are created by managers. Ask your project manager or team lead to add this one.`;
    }
    res.json(answer);
  });
  return r;
}
