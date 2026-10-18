# Flowstate

**Free project management for unlimited users.** Jira-level features (boards, sprints, backlog, epics, timelines, reports) with a Trello-calm interface, a private daily to-do list ("My day"), and a free built-in AI guide.

Built UK-first (en-GB dates, Monday weeks, British English), with US and Asia-Pacific date formats one click away.

## What's inside

| Area | Features |
| --- | --- |
| **Onboarding** | Landing page → sign-up (email or Google) → 5-step setup (role, workspace & region, methodology with "Help me choose", invite team, ready) with optional example work |
| **Methodologies** | Waterfall, Scrum, Kanban, Lean, Six Sigma, PRINCE2 and Scrumban (hybrid), plus a simple workflow. Each one sets its own board columns and WIP limits, work item types and terms, views, reports and rhythm. Switch at any time without losing data. See the table below |
| **Boards** | Drag & drop with mouse, touch (long-press) and keyboard; inline quick-add; WIP limits; sprint/all-work scope; filters (text, assignee, priority, type, label, "only mine") |
| **Planning** | Backlog with sprints: create, drag to plan, reorder, start (goal + length), complete (move leftovers to backlog / next / new sprint) |
| **Work items** | Epic, feature, story, task, bug, sub-task; status, priority, assignee, reporter, sprint, epic, story points, start/due dates, labels, checklist, sub-tasks, links (blocks / is blocked by / relates / duplicates), comments with @mentions, full history, watching |
| **Views** | Board, Backlog, List (sortable), Timeline (epics + dated work), Calendar (create by day) |
| **Reports** | Sprint burndown, velocity, created vs resolved, cycle time, workload, status and priority mix — each with a table view |
| **Personal** | My tasks (grouped by due date, across projects) and **My day**: private to-dos by time of day, stars, roll-over, "do it tomorrow", 7-day momentum, pin project work |
| **Flow guide (free AI)** | Plans your day, spots blockers/overdue/WIP breaches, sizes the next sprint from velocity, writes your stand-up, summarises projects, shows workload, answers how-to questions with "Take me there", and turns sentences into work items or to-dos |
| **Team** | Unlimited members, admin/member/viewer roles, email invite links and reusable team links |
| **Everywhere** | ⌘K command palette, keyboard shortcuts (`?`), notifications, realtime updates (SSE), light/dark/system themes, compact mode, reduced motion, responsive down to phones |

## Methodologies

All methodology behaviour is defined in one shared config, [`shared/methodologies.js`](shared/methodologies.js). The API and the web app both read from it.

| Methodology | Structure | Governance | Metrics |
| --- | --- | --- | --- |
| **Waterfall** | 6 sequential phases (Requirements → Maintenance), each with a sign-off gate. Gantt timeline. Deliverables and milestones | Project definition (scope, budget, acceptance), risk register (P×I heat map), change log | Phase progress, created vs resolved, workload |
| **Scrum** | Backlog and required sprints (goal, length, completion), story points | Impediments | Burndown, velocity |
| **Kanban** | Continuous flow, WIP limits on every active column, class-of-service swimlanes with an expedite lane | — | Cumulative flow, cycle time (50th/85th percentile), throughput |
| **Lean** | Ideas → Define value → Build → Measure → Learned. Value streams and experiments | Value definition, waste log (8 wastes), kaizen ideas | Cumulative flow, cycle time, flow efficiency, Little's law |
| **Six Sigma** | DMAIC phases with tollgates | Charter (problem, goal, CTQ, LSL/USL), FMEA with RPN, lessons log | Individuals control chart (±3σ, Western Electric signals), Cp/Cpk, sigma level, DPMO calculator |
| **PRINCE2** | Management stages with stage-boundary approval. Products, work packages and activities | Business case and PID (tolerances, Project Board roles), risk, issue, quality and lessons logs | Stage progress, workload |
| **Scrumban** | Kanban flow with a WIP-limited "Ready" buffer, optional iterations, and an on-demand planning trigger | Impediments | Cumulative flow, cycle time, throughput, burndown |

Phase gates run strictly in order: start → submit for review → approve (with a recorded decision) → the next phase opens. Approving while items are still open requires a written decision, and every decision goes into the gate log.

## The AI is free — how

The Flow guide runs **inside the Flowstate server** using your workspace data: intent detection, a natural-language parser (dates, priorities, people, labels), and a product knowledge base. No paid API, no usage limits, and no data leaves your server.

For richer free-form conversation you can optionally point it at a **self-hosted open-source model** via [Ollama](https://ollama.com) — still free:

```bash
OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=llama3.2 npm start
```

Structured actions (creating work, planning) always use the built-in engine; the model only rephrases open-ended answers, with an automatic fallback if it's slow or offline.

## Run it

Requires **Node 22.5+** (uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
npm run dev          # API on :4000, web on http://localhost:5173
```

**Windows shortcut:** double-click `start-windows.bat` in the project folder — it installs everything and opens the app in your browser.

Then open **http://localhost:5173** in your browser *on the same computer* where you ran the commands.

### Not loading?

| Symptom | Fix |
| --- | --- |
| "This site can't be reached" | The dev servers aren't running on *this* machine. Run `npm install` then `npm run dev` in the project folder and keep that terminal open. |
| "Flowstate needs Node.js 22.5 or newer" | Install the current LTS from [nodejs.org](https://nodejs.org), then `npm install` again. Check with `node -v`. |
| Page loads but sign-up fails / "offline" | The API (port 4000) didn't start — read the `[api]` lines in the terminal. Another app may be using port 4000 or 5173. |
| `npm` not found | Install Node.js (it includes npm). |

Production:

```bash
npm run build
SESSION_SECRET=$(openssl rand -hex 32) npm start   # serves app + API on :4000
```

Shareable demo (no server needed):

```bash
npm run build:demo -w web   # outputs web/dist-demo — a static site
```

The demo runs the real API route code inside the browser against SQLite compiled to JavaScript, and keeps data in that browser's local storage. Host `web/dist-demo` on any static host to let people try Flowstate instantly.

Docker:

```bash
docker build -t flowstate .
docker run -p 4000:4000 -e SESSION_SECRET=change-me -v flowstate-data:/data flowstate
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | *(required in production)* | Signs session cookies |
| `PORT` | `4000` | HTTP port |
| `DATABASE_URL` | — | Postgres connection string (e.g. Supabase). When set, it's used instead of SQLite. See [SUPABASE.md](SUPABASE.md) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Turns on "Continue with Google". See [GOOGLE.md](GOOGLE.md) |
| `DATABASE_FILE` | `server/data/flowstate.db` | SQLite file location (when `DATABASE_URL` is not set) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | — | Optional self-hosted model for the Flow guide |

## Quality

```bash
npm test             # API + parser tests (node:test, in-memory SQLite)
TEST_DATABASE_URL=postgres://… npm test   # same suite on a disposable Postgres database (it drops Flowstate tables there)
npm run typecheck    # strict TypeScript for the web app
npm run check        # typecheck + tests + production build
```

## Architecture

```
server/  Node + Express 5 + node:sqlite or PostgreSQL / Supabase
  src/app.js            app factory (security headers, CSRF guard, routes)
  src/db.js             SQLite schema + versioned migrations
  src/db-postgres.js    Postgres adapter (same API) + schema/postgres.sql
  src/routes/           auth, workspaces/invites, projects/sprints/reports, issues, personal (to-dos, notifications), ai
  src/services/         issue & project domain logic (validation, ranking, activity, notifications)
  src/ai/               Flow guide: intents, NL parser, knowledge base, optional Ollama
  src/realtime.js       SSE hub — "something changed" hints, never data
web/     React 19 + TypeScript + Vite
  src/lib/              API client, React Query hooks (optimistic updates), stores, formatting, theme
  src/layout/           app shell, sidebar, top bar, command palette, shortcuts
  src/features/         auth, onboarding, home, project views, issue detail, personal, team, settings, ai
  src/styles/           prototype.css (design source of truth) + app.css (extensions, dark mode, responsive)
```

**Security:** scrypt password hashing, HMAC-signed httpOnly SameSite cookies, CSRF header check on every mutation, strict role checks on every route, workspace isolation, parameterised SQL, input validation with zod, rate-limited credential endpoints, security headers.

**Accessibility:** keyboard-operable drag & drop, focus-trapped dialogs, labelled controls, visible focus rings, colour never the only signal, reduced-motion support, charts with table alternatives.

## Honest limits (next steps)

- Invitations generate shareable links; Flowstate doesn't send email yet (plug in SMTP to automate).
- File attachments, custom fields, automations and SSO are not built yet.
- SQLite suits teams up to thousands of users on one server. For hosted or multi-instance setups, set `DATABASE_URL` to Postgres / Supabase ([SUPABASE.md](SUPABASE.md)). The realtime hub is per-process, so multiple instances would also need a shared broadcast channel.
