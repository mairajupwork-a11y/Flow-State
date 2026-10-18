import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { parse } from '../http.js';
import { loadWorkspace } from '../access.js';

export function aiRoutes({ db, guide }) {
  const r = Router();
  r.use(requireUser);
  r.post('/:ws/ask', async (req, res) => {
    const { ws, membership } = await loadWorkspace(db, req.user, req.params.ws);
    const body = parse(z.object({ question: z.string().trim().min(1, 'ask me something').max(600), projectId: z.number().int().positive().nullable().optional() }), req.body);
    const answer = await guide.ask({ user: req.user, ws, projectId: body.projectId ?? null, question: body.question });
    // Viewers can't create work, so don't offer buttons that would only fail.
    if (membership.role === 'viewer' && answer.actions?.some((a) => a.type === 'create_issue')) {
      answer.actions = answer.actions.filter((a) => a.type !== 'create_issue');
      answer.text = `${answer.text}\n\nYou have view-only access here, so ask an admin for member access to create work items.`;
    }
    res.json(answer);
  });
  return r;
}
