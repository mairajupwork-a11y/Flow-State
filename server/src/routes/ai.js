import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { parse } from '../http.js';
import { loadWorkspace } from '../access.js';

export function aiRoutes({ db, guide }) {
  const r = Router();
  r.use(requireUser);
  r.post('/:ws/ask', async (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const body = parse(z.object({ question: z.string().trim().min(1, 'ask me something').max(600), projectId: z.number().int().positive().nullable().optional() }), req.body);
    res.json(await guide.ask({ user: req.user, ws, projectId: body.projectId ?? null, question: body.question }));
  });
  return r;
}
