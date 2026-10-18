# Connecting Flowstate to Supabase

Flowstate can store its data in Supabase's managed Postgres database instead of a local file. It takes about five minutes, and the free Supabase plan is enough.

When `DATABASE_URL` is set, the server creates every table it needs on first start. It also locks those tables away from Supabase's public browser API. You don't need to run any SQL by hand.

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com/dashboard) and click **New project**.
2. Choose a name, for example `flowstate`.
3. Set a **database password**. Save it in a password manager, because you need it in step 2.
4. Pick the region closest to your users. For UK-first, choose **London (eu-west-2)**.
5. Click **Create new project** and wait until it shows as ready.

## 2. Copy the connection string

1. In the project, click **Connect** at the top of the page.
2. Under **Connection string**, choose **Session pooler**.
   - The session pooler works on every network.
   - The "Direct connection" needs IPv6, which many home and office networks don't have.
3. Copy the URI. It looks like this:

   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
   ```

4. Replace `[YOUR-PASSWORD]` with the database password from step 1.

   If the password contains `@`, `:`, `/`, `#` or `?`, URL-encode those characters (`@` becomes `%40`), or reset the password to one without them.

Use port **5432** (the session pooler), not 6543 (the transaction pooler). Flowstate takes a short session-level lock when it sets up the tables.

## 3. Point Flowstate at it

In the Flowstate folder, copy `.env.example` to a new file named `.env`. Then set:

```
DATABASE_URL=postgresql://postgres.abcdefghijklmnop:your-password@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
```

Start Flowstate as usual: `start-windows.bat` on Windows, or `npm run dev` / `npm start`. The first lines of output confirm the connection:

```
Database: Postgres (aws-0-eu-west-2.pooler.supabase.com)
Flowstate API listening on http://localhost:4000
```

To double-check, open `http://localhost:4000/api/health`. It shows `"database":"postgres"`. In Supabase's **Table Editor** you'll see the Flowstate tables (`users`, `workspaces`, `projects`, `issues` and so on).

**Hosting Flowstate on a server or platform** (Render, Railway, Fly.io, a VPS, Docker): set `DATABASE_URL` and `SESSION_SECRET` as environment variables there instead of using a `.env` file.

## 4. Bring over your existing data (optional)

If you've been using Flowstate locally and want to keep that work, stop Flowstate and run:

```
npm run db:copy-to-postgres
```

The script:
- copies everything from `server/data/flowstate.db` into the database in `DATABASE_URL`;
- keeps all IDs, so passwords, invite links and work item keys keep working;
- refuses to run if the Supabase database already has users. Add `-- --force` to replace them.

## Security notes

- **Keep the connection string server-side.** It contains your database password, so never put it in the web app or commit `.env`. `.env` is already in `.gitignore`.
- **The browser API is locked out.** Supabase exposes tables through a REST API using its `anon` and `authenticated` keys. Flowstate only talks to the database from its own server. Its setup therefore enables row level security on every table, adds no policies, and revokes those roles' access. The `anon` key can read or change nothing.
- **Full certificate verification (optional).** The connection is always encrypted. To also verify Supabase's certificate:
  1. Download the CA from **Project Settings → Database → SSL configuration**.
  2. Set `DATABASE_CA_CERT=/path/to/prod-ca-2021.crt` in `.env`.
- **Backups.** Supabase backs up projects daily on paid plans. On the free plan, export from **Database → Backups**, or use `pg_dump`, regularly.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `password authentication failed` | The password in `DATABASE_URL` is wrong or not URL-encoded. Reset it in **Project Settings → Database** if unsure. |
| `getaddrinfo ENOTFOUND` / `ENETUNREACH` | You copied the direct connection (IPv6). Use the **Session pooler** string instead. |
| `Tenant or user not found` | The username must include the project ref, e.g. `postgres.abcdefghijklmnop`. Copy the string again from **Connect**. |
| Hangs, then `timeout exceeded when trying to connect` | A firewall is blocking outbound port 5432, or the project is paused (free projects pause after a week idle; resume it in the dashboard). |

## Switching back

Remove `DATABASE_URL` from `.env` and Flowstate uses the local SQLite file again. Your Supabase data stays where it is.
