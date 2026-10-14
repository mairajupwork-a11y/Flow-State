/**
 * Server-sent events hub. Each connected browser subscribes to its workspace;
 * mutations publish lightweight "something changed" hints and the client
 * refetches only the affected queries. Payloads never carry private data.
 */
export function createHub() {
  const channels = new Map(); // workspaceId -> Set<{res,userId}>

  function subscribe(workspaceId, userId, res) {
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
    });
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

  return { subscribe, publish, closeAll };
}
