/**
 * Personal to-do reminders. Runs every minute: each to-do whose reminder time
 * has passed (and isn't done) sends one notification — in the app, and by push
 * and email if the person has those turned on.
 */
export async function runReminders(db, { events, now = new Date() } = {}) {
  const due = await db.all(
    `SELECT t.id, t.user_id, t.text, t.issue_id, p.workspace_id AS issue_ws FROM todos t
       LEFT JOIN issues i ON i.id = t.issue_id LEFT JOIN projects p ON p.id = i.project_id
      WHERE t.remind_at IS NOT NULL AND t.reminded_at IS NULL AND t.done = 0 AND t.remind_at <= ?
      ORDER BY t.remind_at LIMIT 200`,
    now.toISOString(),
  );
  for (const t of due) {
    await db.tx(async () => {
      // Claim it first so two servers (or a slow run) never send it twice.
      const claimed = await db.run('UPDATE todos SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL', now.toISOString(), t.id);
      if (!claimed.changes) return;
      const workspaceId = t.issue_ws ?? (await db.get('SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY joined_at DESC LIMIT 1', t.user_id))?.workspace_id;
      if (!workspaceId || !events) return;
      await events.notify({ workspaceId, issueId: t.issue_id ?? null, actorId: null, kind: 'reminder', recipients: [t.user_id], includeActor: true, text: `⏰ Reminder: ${t.text}` });
    });
  }
  return due.length;
}
