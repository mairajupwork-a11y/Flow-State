/**
 * v10: team hierarchy.
 *  - A "manager" access level between admin and member (project, product and program managers, team leads…).
 *  - Project resources: the people who work on a project. Members and viewers only see projects they're on.
 *  - Several assignees per work item (issues.assignee_id stays as the first one, for sorting and reports).
 *  - Invites can put someone straight onto projects.
 *  - Reminders on personal to-dos.
 * Existing data keeps working: everyone already in a workspace becomes a resource of its projects,
 * each item's assignee becomes its first assignee, and members whose job title is a management one
 * become managers (they could already edit everything).
 */
import { MANAGEMENT_DESIGNATIONS } from '../../../shared/designations.js';

const TABLES = ['project_members', 'issue_assignees'];
const ROLES = "('admin','manager','member','viewer')";
const sqlList = (list) => list.map((d) => `'${d.toLowerCase().replace(/'/g, "''")}'`).join(', ');

function render(pg) {
  const now = pg ? "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')" : "(datetime('now'))";
  const ine = pg ? ' IF NOT EXISTS' : '';
  const ignore = (sql) => (pg ? `INSERT INTO ${sql} ON CONFLICT DO NOTHING` : `INSERT OR IGNORE INTO ${sql}`);
  const roles = pg
    ? `ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
       ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ${ROLES});
       ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
       ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ${ROLES});
       ALTER TABLE invites ADD COLUMN IF NOT EXISTS project_ids TEXT NOT NULL DEFAULT '[]';
       ALTER TABLE todos ADD COLUMN IF NOT EXISTS remind_at TEXT;
       ALTER TABLE todos ADD COLUMN IF NOT EXISTS reminded_at TEXT;`
    // SQLite can't change a CHECK constraint, so the two small tables are rebuilt.
    : `CREATE TABLE memberships_v10 (
         workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
         user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         role TEXT NOT NULL CHECK (role IN ${ROLES}),
         joined_at TEXT NOT NULL DEFAULT (datetime('now')),
         PRIMARY KEY (workspace_id, user_id)
       );
       INSERT INTO memberships_v10 (workspace_id, user_id, role, joined_at) SELECT workspace_id, user_id, role, joined_at FROM memberships;
       DROP TABLE memberships;
       ALTER TABLE memberships_v10 RENAME TO memberships;
       CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);
       CREATE TABLE invites_v10 (
         token TEXT PRIMARY KEY,
         workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
         email TEXT NOT NULL COLLATE NOCASE,
         role TEXT NOT NULL CHECK (role IN ${ROLES}),
         invited_by INTEGER NOT NULL REFERENCES users(id),
         designation TEXT NOT NULL DEFAULT '',
         project_ids TEXT NOT NULL DEFAULT '[]',
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         accepted_at TEXT
       );
       INSERT INTO invites_v10 (token, workspace_id, email, role, invited_by, designation, created_at, accepted_at)
         SELECT token, workspace_id, email, role, invited_by, designation, created_at, accepted_at FROM invites;
       DROP TABLE invites;
       ALTER TABLE invites_v10 RENAME TO invites;
       CREATE INDEX IF NOT EXISTS invites_workspace ON invites (workspace_id);
       ALTER TABLE todos ADD COLUMN remind_at TEXT;
       ALTER TABLE todos ADD COLUMN reminded_at TEXT;`;
  return `
  ${roles}
  CREATE TABLE${ine} project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT ${now},
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS project_members_user ON project_members (user_id);
  CREATE TABLE${ine} issue_assignees (
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (issue_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS issue_assignees_user ON issue_assignees (user_id);
  CREATE INDEX IF NOT EXISTS todos_remind ON todos (remind_at);
  ${ignore('project_members (project_id, user_id) SELECT p.id, m.user_id FROM projects p JOIN memberships m ON m.workspace_id = p.workspace_id')};
  ${ignore('issue_assignees (issue_id, user_id, position) SELECT id, assignee_id, 0 FROM issues WHERE assignee_id IS NOT NULL')};
  UPDATE memberships SET role = 'manager'
   WHERE role = 'member' AND user_id IN (SELECT id FROM users WHERE LOWER(TRIM(job_title)) IN (${sqlList(MANAGEMENT_DESIGNATIONS)}));
  ${pg ? lockDown() : ''}`;
}

const lockDown = () => `DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[${TABLES.map((t) => `'${t}'`).join(',')}]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t); END IF;
  END LOOP;
END $$;`;

export const v10Sqlite = () => ({ sql: render(false), fkOff: true });
export const v10Postgres = () => render(true);
