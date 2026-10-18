/** Activity log + notifications, recorded alongside every meaningful change. */
export function createEvents(db, hub) {
  async function record({ workspaceId, projectId = null, issueId = null, actorId, verb, data = {} }) {
    await db.run(
      'INSERT INTO activity (workspace_id, project_id, issue_id, actor_id, verb, data) VALUES (?, ?, ?, ?, ?, ?)',
      workspaceId, projectId, issueId, actorId, verb, JSON.stringify(data),
    );
  }

  /** Notifies each recipient except the actor, and pings their browser. */
  async function notify({ workspaceId, issueId = null, actorId, kind, text, recipients }) {
    const unique = [...new Set(recipients.filter((id) => id && id !== actorId))];
    for (const userId of unique) {
      await db.run(
        'INSERT INTO notifications (user_id, workspace_id, issue_id, actor_id, kind, text) VALUES (?, ?, ?, ?, ?, ?)',
        userId, workspaceId, issueId, actorId, kind, text,
      );
      hub.publish(workspaceId, { scope: ['notifications'], userId });
    }
  }

  function changed(workspaceId, scope, actorId) {
    hub.publish(workspaceId, { scope, actorId });
  }

  return { record, notify, changed };
}
