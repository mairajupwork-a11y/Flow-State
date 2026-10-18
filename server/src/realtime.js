/**
 * Server-sent events hub. Each connected browser subscribes to its workspace;
 * mutations publish lightweight "something changed" hints and the client
 * refetches only the affected queries. Payloads never carry private data.
 */
const MAX_STREAMS_PER_USER = 20; // plenty for many tabs; stops one account hoarding connections

export function createHub() {
  const channels = new Map(); // workspaceId -> Set<{res,userId}>
  const perUser = new Map(); // userId -> open stream count

  function subscribe(workspaceId, userId, res) {
    if ((perUser.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
      res.status(429).json({ error: 'Too many open Flowstate tabs. Close a few and refresh.' });
      return;
    }
    perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const client = { res, userId };
    if (!channels.has(workspaceId)) channels.set(workspaceId, new Set());
    channels.get(workspaceId).add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(ping);
      channels.get(workspaceId)?.delete(client);
      const left = (perUser.get(userId) ?? 1) - 1;
      if (left > 0) perUser.set(userId, left);
      else perUser.delete(userId);
    });
  }

  /** Ends a user's streams for a workspace, e.g. after they're removed from it. */
  function kick(workspaceId, userId) {
    for (const c of channels.get(workspaceId) ?? []) if (c.userId === userId) c.res.end();
  }

  /** @param {{scope:string[], actorId?:number, userId?:number}} event */
  function publish(workspaceId, event) {
    const set = channels.get(workspaceId);
    if (!set) return;
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of set) if (!event.userId || c.userId === event.userId) c.res.write(line);
  }

  function closeAll() {
    for (const set of channels.values()) for (const c of set) c.res.end();
    channels.clear();
  }

  return { subscribe, publish, kick, closeAll };
}
