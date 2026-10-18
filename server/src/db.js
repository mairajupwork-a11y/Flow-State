import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Schema is applied idempotently on boot. Each entry in MIGRATIONS runs once,
 * tracked by PRAGMA user_version, so existing databases upgrade in place.
 */
export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    job_title TEXT NOT NULL DEFAULT '',
    locale TEXT NOT NULL DEFAULT 'en-GB',
    theme TEXT NOT NULL DEFAULT 'light',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE workspaces (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    region TEXT NOT NULL DEFAULT 'uk',
    locale TEXT NOT NULL DEFAULT 'en-GB',
    week_start INTEGER NOT NULL DEFAULT 1,
    team_size TEXT NOT NULL DEFAULT '',
    use_case TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE memberships (
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE invites (
    token TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
    invited_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    template TEXT NOT NULL CHECK (template IN ('scrum','kanban','business')),
    lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issue_seq INTEGER NOT NULL DEFAULT 100,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, key)
  );

  CREATE TABLE statuses (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('todo','progress','done')),
    color TEXT NOT NULL,
    position INTEGER NOT NULL,
    wip_limit INTEGER
  );

  CREATE TABLE sprints (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK (state IN ('planned','active','closed')) DEFAULT 'planned',
    start_date TEXT,
    end_date TEXT,
    completed_at TEXT,
    committed_points INTEGER,
    completed_points INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('epic','feature','story','task','bug','subtask')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id INTEGER NOT NULL REFERENCES statuses(id),
    priority TEXT NOT NULL CHECK (priority IN ('urgent','high','medium','low')) DEFAULT 'medium',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
    epic_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    story_points INTEGER,
    start_date TEXT,
    due_date TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    rank REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    UNIQUE (project_id, number)
  );
  CREATE INDEX issues_project ON issues(project_id, status_id, rank);
  CREATE INDEX issues_assignee ON issues(assignee_id);
  CREATE INDEX issues_sprint ON issues(sprint_id);

  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    edited_at TEXT
  );

  CREATE TABLE issue_links (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('blocks','relates','duplicates')),
    UNIQUE (source_id, target_id, kind)
  );

  CREATE TABLE watchers (
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, user_id)
  );

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verb TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX activity_issue ON activity(issue_id, id);
  CREATE INDEX activity_ws ON activity(workspace_id, id);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    issue_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notifications_user ON notifications(user_id, workspace_id, id);

  CREATE TABLE todos (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    important INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL,
    time_block TEXT NOT NULL DEFAULT 'anytime' CHECK (time_block IN ('morning','afternoon','evening','anytime')),
    issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
    position REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX todos_user_day ON todos(user_id, day);
  `,
  // v2 — methodologies: phases/stages with gates, governance registers,
  // measurements, and relaxed CHECKs on project template and issue type
  // (now validated by the methodology engine). Tables are rebuilt with
  // foreign keys switched off, the standard SQLite procedure.
  {
    fkOff: true,
    sql: `
  CREATE TABLE projects_v2 (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    template TEXT NOT NULL,
    methodology TEXT NOT NULL DEFAULT 'scrum',
    settings TEXT NOT NULL DEFAULT '{}',
    lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issue_seq INTEGER NOT NULL DEFAULT 100,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, key)
  );
  INSERT INTO projects_v2 (id, workspace_id, key, name, description, color, template, methodology, lead_id, issue_seq, archived, created_at)
    SELECT id, workspace_id, key, name, description, color, template, template, lead_id, issue_seq, archived, created_at FROM projects;
  DROP TABLE projects;
  ALTER TABLE projects_v2 RENAME TO projects;

  CREATE TABLE phases (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','review','complete')),
    gate TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    started_at TEXT,
    completed_at TEXT,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX phases_project ON phases(project_id, position);

  CREATE TABLE issues_v2 (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id INTEGER NOT NULL REFERENCES statuses(id),
    priority TEXT NOT NULL CHECK (priority IN ('urgent','high','medium','low')) DEFAULT 'medium',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
    phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
    epic_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
    parent_id INTEGER REFERENCES issues(id) ON DELETE CASCADE,
    story_points INTEGER,
    start_date TEXT,
    due_date TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    rank REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    UNIQUE (project_id, number)
  );
  INSERT INTO issues_v2 (id, project_id, number, type, title, description, status_id, priority, assignee_id, reporter_id, sprint_id,
      epic_id, parent_id, story_points, start_date, due_date, labels, rank, created_at, updated_at, resolved_at)
    SELECT id, project_id, number, type, title, description, status_id, priority, assignee_id, reporter_id, sprint_id,
      epic_id, parent_id, story_points, start_date, due_date, labels, rank, created_at, updated_at, resolved_at FROM issues;
  DROP TABLE issues;
  ALTER TABLE issues_v2 RENAME TO issues;
  CREATE INDEX issues_project ON issues(project_id, status_id, rank);
  CREATE INDEX issues_assignee ON issues(assignee_id);
  CREATE INDEX issues_sprint ON issues(sprint_id);
  CREATE INDEX issues_phase ON issues(phase_id);

  CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX entries_project ON entries(project_id, kind);

  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    value REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX measurements_project ON measurements(project_id, day);
  `,
  },
  // v3 — the designation (job title) someone is invited as, e.g. "Project Manager".
  `ALTER TABLE invites ADD COLUMN designation TEXT NOT NULL DEFAULT '';`,
  // v4: revocable sessions and proof of email ownership (Google sign-in).
  `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
   -- Indexes for foreign keys and hot lookups (Postgres already had the first seven).
   CREATE INDEX IF NOT EXISTS statuses_project ON statuses (project_id);
   CREATE INDEX IF NOT EXISTS sprints_project ON sprints (project_id);
   CREATE INDEX IF NOT EXISTS issues_parent ON issues (parent_id);
   CREATE INDEX IF NOT EXISTS issues_epic ON issues (epic_id);
   CREATE INDEX IF NOT EXISTS checklist_issue ON checklist_items (issue_id);
   CREATE INDEX IF NOT EXISTS comments_issue ON comments (issue_id);
   CREATE INDEX IF NOT EXISTS activity_project ON activity (project_id);
   CREATE INDEX IF NOT EXISTS issues_status_rank ON issues (status_id, rank);
   CREATE INDEX IF NOT EXISTS notifications_issue ON notifications (issue_id);
   CREATE INDEX IF NOT EXISTS todos_issue ON todos (issue_id);
   CREATE INDEX IF NOT EXISTS issue_links_target ON issue_links (target_id);
   CREATE INDEX IF NOT EXISTS invites_workspace ON invites (workspace_id);
   CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);`,
];

export function openDatabase(file = process.env.DATABASE_FILE || 'data/flowstate.db') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  runMigrations(raw);
  return wrap(raw);
}

/**
 * Applies pending migrations. Works with any DatabaseSync-like object
 * (node:sqlite, or the sql.js adapter used by the browser demo).
 * Migrations marked `fkOff` rebuild tables, so foreign keys are disabled
 * around them (PRAGMA foreign_keys cannot change inside a transaction)
 * and integrity is verified before committing.
 */
export function runMigrations(raw) {
  const version = raw.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    const m = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] } : MIGRATIONS[v];
    if (m.fkOff) raw.exec('PRAGMA foreign_keys = OFF');
    raw.exec('BEGIN');
    try {
      raw.exec(m.sql);
      if (m.fkOff && raw.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${v + 1} left broken references.`);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    } finally {
      if (m.fkOff) raw.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/**
 * Small ergonomic layer over node:sqlite with a statement cache and nested-safe
 * transactions. Callers always `await` its results so the same code runs on
 * the Postgres adapter (db-postgres.js), which is truly asynchronous.
 */
export function wrap(raw) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  let pending = [];
  return {
    raw,
    all: (sql, ...params) => stmt(sql).all(...params),
    get: (sql, ...params) => stmt(sql).get(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    exec: (sql) => raw.exec(sql),
    // node:sqlite is synchronous, so awaiting inside a transaction never yields
    // to another request: the transaction completes before other I/O runs.
    async tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      let queued;
      try {
        const result = await fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        pending = [];
        throw err;
      } finally {
        depth--;
        [queued, pending] = [pending, []];
        for (const f of queued) f();
      }
    },
    /** Runs fn once the current transaction commits (dropped on rollback), or now outside one. */
    afterCommit(fn) {
      if (depth > 0) pending.push(fn);
      else fn();
    },
    close: async () => raw.close(),
    dialect: 'sqlite',
  };
}
