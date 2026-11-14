/** Audit trail for sensitive workspace changes (who did what, when, from where). Never throws. */
export async function audit(db, { workspaceId, userId = null, action, target = '', detail = '', ip = '' }) {
  try {
    await db.run('INSERT INTO audit_log (workspace_id, user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      workspaceId, userId, action, String(target).slice(0, 200), String(detail).slice(0, 500), String(ip ?? '').slice(0, 64));
  } catch { /* the audit trail must never break the action itself */ }
}
