# Flowstate

**Free project management for unlimited users.** Jira-level features (boards, sprints, backlog, epics, timelines, reports) with a Trello-calm interface, a private daily to-do list ("My day"), and a free built-in AI guide.

Built UK-first (en-GB dates, Monday weeks, British English), with US and Asia-Pacific date formats one click away.

## What's inside

| Area | Features |
| --- | --- |
| **Onboarding** | Landing page → sign-up → 5-step setup (role, workspace & region, workflow template, invite team, ready) with optional example work |
| **Boards** | Drag & drop with mouse, touch (long-press) and keyboard; inline quick-add; WIP limits; sprint/all-work scope; filters (text, assignee, priority, type, label, "only mine") |
| **Planning** | Backlog with sprints: create, drag to plan, reorder, start (goal + length), complete (move leftovers to backlog / next / new sprint) |
| **Work items** | Epic, feature, story, task, bug, sub-task; status, priority, assignee, reporter, sprint, epic, story points, start/due dates, labels, checklist, sub-tasks, links (blocks / is blocked by / relates / duplicates), comments with @mentions, full history, watching |
| **Views** | Board, Backlog, List (sortable), Timeline (epics + dated work), Calendar (create by day) |
| **Reports** | Sprint burndown, velocity, created vs resolved, cycle time, workload, status and priority mix — each with a table view |
| **Personal** | My tasks (grouped by due date, across projects) and **My day**: private to-dos by time of day, stars, roll-over, "do it tomorrow", 7-day momentum, pin project work |
| **Flow guide (free AI)** | Plans your day, spots blockers/overdue/WIP breaches, sizes the next sprint from velocity, writes your stand-up, summarises projects, shows workload, answers how-to questions with "Take me there", and turns sentences into work items or to-dos |
| **Team** | Unlimited members, admin/member/viewer roles, email invite links and reusable team links |
| **Everywhere** | ⌘K command palette, keyboard shortcuts (`?`), notifications, realtime updates (SSE), light/dark/system themes, compact mode, reduced motion, responsive down to phones |

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

Docker:

```bash
docker build -t flowstate .
docker run -p 4000:4000 -e SESSION_SECRET=change-me -v flowstate-data:/data flowstate
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | *(required in production)* | Signs session cookies |
| `PORT` | `4000` | HTTP port |
| `DATABASE_FILE` | `server/data/flowstate.db` | SQLite file location |
| `OLLAMA_URL`, `OLLAMA_MODEL` | — | Optional self-hosted model for the Flow guide |

## Quality

```bash
npm test             # API + parser tests (node:test, in-memory DB)
npm run typecheck    # strict TypeScript for the web app
npm run check        # typecheck + tests + production build
```

## Architecture

```
server/  Node + Express 5 + node:sqlite
  src/app.js            app factory (security headers, CSRF guard, routes)
  src/db.js             schema + versioned migrations
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
- SQLite suits teams up to thousands of users on one server; move to Postgres for multi-node scale.
