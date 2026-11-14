/** v12: an organisation logo per workspace (a small image as a data URL, resized in the browser). */
export const v12Sqlite = () => "ALTER TABLE workspaces ADD COLUMN logo TEXT NOT NULL DEFAULT '';";
export const v12Postgres = () => "ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo TEXT NOT NULL DEFAULT ''";
