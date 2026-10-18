import { ARTICLES } from './knowledge.js';
import { parseIssueDraft } from './parse.js';
import { ISSUE_SELECT, issue as serializeIssue } from '../serialize.js';
import { PRIORITY_ORDER } from '../services/issues.js';
import { isoDay, daysBetween } from '../dates.js';
import { METHODOLOGIES, PRIMARY_METHODOLOGIES, REGISTERS, methodology, recommend, term } from '../../../shared/methodologies.js';

const STOP = new Set('a an the to do i my me is are how can what where why when of in on for and or with it this that you your we our please should could would will'.split(' '));
const words = (s) => s.toLowerCase().replace(/[^a-z0-9@\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
const byUrgency = (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
const fmt = (iso, locale) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : 'no date');

/**
 * The Flow guide: a free assistant that answers from live workspace data.
 * Intent handlers produce structured answers (text + follow-ups + actions);
 * an optional self-hosted model (Ollama) can rephrase open-ended answers.
 */
export function createGuide({ db, llm = null }) {
  async function context(user, ws, projectId) {
    const members = await db.all('SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ?', ws.id);
    const project = projectId ? await db.get('SELECT * FROM projects WHERE id = ? AND workspace_id = ?', projectId, ws.id) : null;
    const scopeSql = project ? 'i.project_id = ?' : 'p.workspace_id = ? AND p.archived = 0';
    const issues = (await db.all(`${ISSUE_SELECT} WHERE ${scopeSql}`, project ? project.id : ws.id)).map(serializeIssue);
    const open = issues.filter((i) => i.statusCategory !== 'done' && i.type !== 'epic');
    const blockedIds = new Set((await db.all(
      `SELECT l.target_id AS id FROM issue_links l JOIN issues s ON s.id = l.source_id JOIN statuses st ON st.id = s.status_id
        WHERE l.kind = 'blocks' AND st.category <> 'done'`)).map((r) => r.id));
    const sprint = project ? await db.get("SELECT * FROM sprints WHERE project_id = ? AND state = 'active'", project.id) : null;
    return { user, ws, members, project, issues, open, blockedIds, sprint, today: isoDay(), locale: ws.locale, name: (id) => members.find((m) => m.id === id)?.name ?? 'Unassigned' };
  }

  const intents = [
    { test: /^(hi|hello|hey|good (morning|afternoon|evening)|yo)\b/i, run: greet },
    { test: /\b(remind me|add to (my day|my list|today)|to-?do:?|put .* on my (day|list))\b/i, run: addTodo },
    { test: /^\s*(please\s+)?(can you\s+)?(create|add|new|log|raise|make|open|file)\b(?!.*\b(project|column|sprint|workspace)\b)/i, run: createDraft },
    { test: /\b(stand-?up|daily update|status update|what did i do|yesterday)\b/i, run: standup },
    { test: /\b(methodolog\w*|which (framework|approach|method)|framework should|(scrum|kanban|waterfall|lean|six sigma|sixsigma|prince ?2|scrumban|hybrid)\b.*\b(vs|versus|or|compare|difference|what is|explain|when)|(what is|explain|how does|when to use) (scrum|kanban|waterfall|lean|six sigma|prince ?2|scrumban|hybrid|dmaic))/i, run: methodologyAdvice },
    { test: /\b(block|blocker|risk|stuck|overdue|late|behind|problem|attention|slipping)\w*/i, run: risks },
    { test: /\b(workload|overload|busy|capacity of|who (is|has)|free to|balance|too much)\b/i, run: workload },
    { test: /\b(sprint plan|plan (a|the|my|next) sprint|plan sprint|next sprint|sprint capacity|what should go in)\b/i, run: sprintPlan },
    { test: /\b(summar|overview|status of|progress|how (are|is) (we|the project)|report on|health)\w*/i, run: summary },
    { test: /\b(prioriti|focus|my day|what should i (do|work)|today|next task|start with|plan my)\w*/i, run: focus },
  ];

  function greet(c) {
    const mine = c.open.filter((i) => i.assigneeId === c.user.id);
    return {
      text: `Hello ${c.user.name.split(' ')[0]} 👋 I'm your Flow guide — free, always.\n\nYou have **${mine.length} open item${mine.length === 1 ? '' : 's'}** assigned to you${c.project ? ` in ${c.project.name}` : ''}. I can plan your day, spot blockers, draft work items from a sentence, or show you around.`,
      suggestions: ['Prioritise my day', 'What needs attention?', 'How do sprints work?', 'Create a task to update the FAQ, due Friday'],
    };
  }

  function addTodo(c, q) {
    const text = q.replace(/^.*?\b(remind me to|remind me|add to (my day|my list|today)|to-?do:?)\s*/i, '').replace(/\bon my (day|list)\b/i, '').trim();
    if (!text) return { text: 'What would you like on today’s list? Try “remind me to call the supplier”.', suggestions: ['Remind me to send the weekly update'] };
    return {
      text: `I’ll add this to **My day** — your private to-do list:\n\n• ${text}`,
      actions: [{ type: 'add_todo', label: 'Add to My day', payload: { text: text[0].toUpperCase() + text.slice(1) } }],
      suggestions: ['Prioritise my day'],
    };
  }

  function createDraft(c, q) {
    if (!c.project) return { text: 'Open a project first and I’ll draft the work item there. Pick one from the sidebar.', suggestions: ['How do I create a project?'] };
    const draft = parseIssueDraft(q, { members: c.members, me: c.user, locale: c.locale });
    if (!draft.title) return { text: 'Tell me what the work is about — for example: “create a high priority bug: login fails on Safari, assign to me, due tomorrow”.' };
    const lines = [
      `**${draft.title}**`,
      `Type: ${draft.type} · Priority: ${draft.priority}`,
      `Assignee: ${draft.assigneeId ? c.name(draft.assigneeId) : 'Unassigned'} · Due: ${draft.dueDate ? fmt(draft.dueDate, c.locale) : 'no date'}`,
      draft.labels.length ? `Labels: ${draft.labels.join(', ')}` : '',
    ].filter(Boolean);
    return {
      text: `Here’s the draft for **${c.project.key}**. Check it over, then create it:\n\n${lines.join('\n')}`,
      actions: [{ type: 'create_issue', label: 'Create work item', payload: { projectId: c.project.id, ...draft } }],
      suggestions: ['What needs attention?'],
    };
  }

  async function focus(c) {
    const mine = c.open.filter((i) => i.assigneeId === c.user.id).sort(byUrgency);
    const todos = await db.all('SELECT text FROM todos WHERE user_id = ? AND done = 0 AND day <= ? ORDER BY important DESC, position LIMIT 3', c.user.id, c.today);
    if (!mine.length && !todos.length) {
      const unassigned = c.open.filter((i) => !i.assigneeId).sort(byUrgency).slice(0, 3);
      return {
        text: `Your plate is clear — nothing is assigned to you${c.project ? ' here' : ''}. ${unassigned.length ? `A few unowned items could use a hand:\n\n${unassigned.map((i) => `• **${i.key}** ${i.title} (${i.priority})`).join('\n')}` : 'A great moment to plan ahead or help a teammate.'}`,
        actions: unassigned.slice(0, 1).map((i) => ({ type: 'open_issue', label: `Open ${i.key}`, payload: { key: i.key } })),
        suggestions: ['What needs attention?', 'Summarise the project'],
      };
    }
    const top = mine.slice(0, 3);
    const overdue = mine.filter((i) => i.dueDate && i.dueDate < c.today);
    const plan = top.map((i, n) => `${n + 1}. **${i.key}** ${i.title} — ${i.priority}${i.dueDate ? `, due ${fmt(i.dueDate, c.locale)}` : ''}${c.blockedIds.has(i.id) ? ' ⚠️ blocked' : ''}`);
    return {
      text: [
        `Here’s a calm, realistic plan for today:`,
        '',
        ...plan,
        todos.length ? `\nFrom your **My day** list: ${todos.map((t) => `“${t.text}”`).join(', ')}.` : '',
        overdue.length ? `\n${overdue.length} of your items ${overdue.length === 1 ? 'is' : 'are'} overdue — start there or agree a new date.` : '',
        '\nTip: protect a 90-minute focus block for #1 before checking messages.',
      ].filter((l) => l !== '').join('\n'),
      actions: [
        ...top.slice(0, 1).map((i) => ({ type: 'open_issue', label: `Open ${i.key}`, payload: { key: i.key } })),
        { type: 'plan_day', label: 'Pin these to My day', payload: { items: top.map((i) => ({ text: i.title, issueRef: i.key })) } },
      ],
      suggestions: ['What needs attention?', 'Write my stand-up'],
    };
  }

  async function risks(c) {
    const overdue = c.open.filter((i) => i.dueDate && i.dueDate < c.today);
    const blocked = c.open.filter((i) => c.blockedIds.has(i.id));
    const urgentUnowned = c.open.filter((i) => !i.assigneeId && (i.priority === 'urgent' || i.priority === 'high'));
    const dueSoon = c.open.filter((i) => i.dueDate && i.dueDate >= c.today && daysBetween(c.today, i.dueDate) <= 2 && i.statusCategory === 'todo');
    const wip = c.project ? await db.all(
      `SELECT s.name, s.wip_limit, COUNT(i.id) AS n FROM statuses s LEFT JOIN issues i ON i.status_id = s.id
        WHERE s.project_id = ? AND s.wip_limit IS NOT NULL GROUP BY s.id, s.name, s.wip_limit HAVING COUNT(i.id) > s.wip_limit`, c.project.id) : [];
    const sections = [];
    const list = (arr) => arr.slice(0, 4).map((i) => `• **${i.key}** ${i.title} — ${c.name(i.assigneeId)}${i.dueDate ? `, due ${fmt(i.dueDate, c.locale)}` : ''}`).join('\n');
    if (overdue.length) sections.push(`**Overdue (${overdue.length})**\n${list(overdue.sort(byUrgency))}`);
    if (blocked.length) sections.push(`**Blocked by unfinished work (${blocked.length})**\n${list(blocked)}`);
    if (urgentUnowned.length) sections.push(`**High priority with no owner (${urgentUnowned.length})**\n${list(urgentUnowned)}`);
    if (dueSoon.length) sections.push(`**Due within 2 days but not started (${dueSoon.length})**\n${list(dueSoon)}`);
    if (wip.length) sections.push(`**Columns over their WIP limit**\n${wip.map((w) => `• ${w.name}: ${w.n} / ${w.wip_limit}`).join('\n')}`);
    if (c.project) {
      const m = methodology(c.project.methodology);
      const latePhase = await db.get("SELECT name, end_date, state FROM phases WHERE project_id = ? AND state IN ('active','review') AND end_date < ? ORDER BY position LIMIT 1", c.project.id, c.today);
      if (latePhase) sections.push(`**${term(m.id, 'phase')} running late**\n• ${latePhase.name} was due to pass its ${m.features.phases === 'dmaic' ? 'tollgate' : 'gate'} on ${fmt(latePhase.end_date, c.locale)}${latePhase.state === 'review' ? ' — it is waiting for approval' : ''}.`);
      const entries = await db.all('SELECT kind, title, status, data FROM entries WHERE project_id = ?', c.project.id);
      const hot = entries.filter((e) => {
        const def = REGISTERS[e.kind];
        if (!def?.score || e.status === def.statuses[def.statuses.length - 1]) return false;
        const d = JSON.parse(e.data || '{}');
        return def.score === 'pxi' ? (d.probability ?? 0) * (d.impact ?? 0) >= 15 : (d.severity ?? 0) * (d.occurrence ?? 0) * (d.detection ?? 0) >= 200;
      });
      if (hot.length) sections.push(`**High-scoring risks (${hot.length})**\n${hot.slice(0, 4).map((e) => `• ${e.title} (${REGISTERS[e.kind].label})`).join('\n')}`);
    }
    if (c.sprint?.end_date) {
      const left = daysBetween(c.today, c.sprint.end_date);
      const inSprint = c.open.filter((i) => i.sprintId === c.sprint.id);
      if (left <= 3 && inSprint.length) sections.push(`**Sprint ends in ${Math.max(left, 0)} day${left === 1 ? '' : 's'}** with ${inSprint.length} item${inSprint.length === 1 ? '' : 's'} still open.`);
    }
    if (!sections.length) return { text: `Good news — nothing is overdue, blocked or unowned${c.project ? ` in ${c.project.name}` : ''}. The team is in a healthy flow. 🌿`, suggestions: ['Summarise the project', 'Prioritise my day'] };
    const first = overdue[0] ?? blocked[0] ?? urgentUnowned[0] ?? dueSoon[0];
    return {
      text: `Here’s what needs attention:\n\n${sections.join('\n\n')}\n\nSuggested next step: agree owners and new dates for the top items before taking on anything new.`,
      actions: first ? [{ type: 'open_issue', label: `Open ${first.key}`, payload: { key: first.key } }] : [],
      suggestions: ['Who has too much on?', 'Prioritise my day'],
    };
  }

  function methodologyAdvice(c, q) {
    const lower = q.toLowerCase();
    // "scrumban" contains both "scrum" and "kanban", so match those on the remaining text.
    const rest = lower.replace(/scrumban|hybrid/g, ' ');
    const MATCH = {
      waterfall: /waterfall/.test(lower), scrum: /\bscrum\b/.test(rest), kanban: /\bkanban\b/.test(rest), lean: /\blean\b/.test(lower),
      sixsigma: /six ?sigma|dmaic/.test(lower), prince2: /prince ?2/.test(lower), scrumban: /scrumban|hybrid/.test(lower),
    };
    const named = PRIMARY_METHODOLOGIES.filter((id) => MATCH[id]);
    const describe = (id) => {
      const m = METHODOLOGIES[id];
      return `**${m.name}** (${m.family}) — ${m.description}\n• Best for: ${m.bestFor.join(', ')}\n• Scale: ${m.scale} · Cadence: ${m.cadence}\n• Rhythm: ${m.ceremonies.join(' · ')}`;
    };
    if (named.length) {
      return {
        text: `${named.map(describe).join('\n\n')}${named.length > 1 ? '\n\n**In short:** pick the one whose “best for” matches your work — you can switch any project later in **Project settings → Methodology** without losing data.' : ''}`,
        actions: c.project ? [{ type: 'navigate', label: 'Project settings', payload: { to: `p/${c.project.key}/settings` } }] : [],
        suggestions: ['Which methodology should I use?', 'Scrum vs Kanban', 'What is PRINCE2?'],
      };
    }
    // Infer answers from the question; default to a product-team profile.
    const a = {
      requirements: /fixed|contract|regulat|compliance|construction|hardware/.test(lower) ? 'fixed' : /experiment|start-?up|unknown|validate|mvp/.test(lower) ? 'unknown' : 'evolving',
      work: /defect|quality|process|reduce|variation/.test(lower) ? 'improve' : /support|ops|operations|requests|tickets|service/.test(lower) ? 'stream' : /app|product|software|mobile|web/.test(lower) ? 'product' : /project|launch|migration|build/.test(lower) ? 'project' : undefined,
      governance: /board|governance|public sector|government|formal|audit/.test(lower) ? 'formal' : undefined,
      size: /large|enterprise|multi|programme|program/.test(lower) ? 'large' : /small|tiny|solo|startup|start-up/.test(lower) ? 'small' : undefined,
    };
    const ranked = recommend(a).slice(0, 3);
    const current = c.project ? methodology(c.project.methodology) : null;
    return {
      text: [
        current ? `${c.project.name} currently runs **${current.name}**.\n` : '',
        '**My recommendation**',
        ...ranked.map((r, k) => `${k + 1}. **${METHODOLOGIES[r.id].name}** — ${METHODOLOGIES[r.id].tagline}${r.reasons.length ? ` (${[...new Set(r.reasons)].slice(0, 2).join('; ')})` : ''}`),
        '\nQuick guide: fixed scope & sign-offs → **Waterfall**; formal board & business case → **PRINCE2**; evolving product in sprints → **Scrum**; steady stream of requests → **Kanban**; app/product build mixing planned and reactive work → **Scrumban**; experiments & waste removal → **Lean**; measurable defect reduction → **Six Sigma**.',
        '\nTell me more (team size, fixed or changing requirements, need for approvals) and I’ll refine this. The **Help me choose** button when creating a project asks the same questions.',
      ].filter(Boolean).join('\n'),
      suggestions: ['Scrum vs Kanban', 'What is Scrumban?', 'What is PRINCE2?', 'Explain Six Sigma DMAIC'],
    };
  }

  function workload(c) {
    const rows = c.members.map((m) => {
      const items = c.open.filter((i) => i.assigneeId === m.id);
      return { name: m.name, n: items.length, pts: items.reduce((a, i) => a + (i.storyPoints ?? 0), 0), overdue: items.filter((i) => i.dueDate && i.dueDate < c.today).length };
    }).sort((a, b) => b.n - a.n);
    const avg = rows.reduce((a, r) => a + r.n, 0) / Math.max(rows.length, 1);
    const heavy = rows.filter((r) => r.n > Math.max(avg * 1.5, 3));
    const light = rows.filter((r) => r.n < avg * 0.5);
    return {
      text: [
        `**Open work by person**${c.project ? ` in ${c.project.name}` : ''}:`,
        '',
        ...rows.map((r) => `• ${r.name}: ${r.n} item${r.n === 1 ? '' : 's'}${r.pts ? ` · ${r.pts} pts` : ''}${r.overdue ? ` · ${r.overdue} overdue` : ''}`),
        heavy.length ? `\n${heavy.map((h) => h.name.split(' ')[0]).join(' and ')} ${heavy.length === 1 ? 'looks' : 'look'} stretched.${light.length ? ` ${light.map((l) => l.name.split(' ')[0]).join(', ')} may have room to help.` : ''}` : '\nThe load looks fairly balanced. 👍',
      ].join('\n'),
      actions: c.project ? [{ type: 'navigate', label: 'Open reports', payload: { to: `p/${c.project.key}/reports` } }] : [],
      suggestions: ['What needs attention?'],
    };
  }

  async function sprintPlan(c) {
    if (!c.project) return { text: 'Open a Scrum project and ask me again — I’ll size the next sprint from your velocity.' };
    const m = methodology(c.project.methodology);
    if (!m.features.sprints) {
      return { text: m.phases
        ? `${c.project.name} runs **${m.name}**, which plans by ${term(m.id, 'phases').toLowerCase()} rather than sprints. Focus on the active ${term(m.id, 'phase').toLowerCase()} and its ${m.features.phases === 'dmaic' ? 'tollgate' : 'gate'} criteria — open the **${term(m.id, 'phases')}** view to see what's needed to pass.`
        : `${c.project.name} runs **${m.name}** — continuous flow, so there are no sprints. Keep the first column ordered by priority, pull work only when a WIP limit allows, and watch cycle time in Reports.`,
      actions: [{ type: 'navigate', label: m.phases ? `Open ${term(m.id, 'phases')}` : 'Open reports', payload: { to: `p/${c.project.key}/${m.phases ? 'phases' : 'reports'}` } }] };
    }
    const velocity = (await db.all("SELECT completed_points FROM sprints WHERE project_id = ? AND state = 'closed' ORDER BY completed_at DESC LIMIT 3", c.project.id)).map((s) => s.completed_points ?? 0);
    const capacity = velocity.length ? Math.round(velocity.reduce((a, b) => a + b, 0) / velocity.length) : 20;
    const backlog = c.open.filter((i) => !i.sprintId && !i.parentId).sort((a, b) => byUrgency(a, b) || a.rank - b.rank);
    const picked = [];
    let total = 0;
    for (const i of backlog) {
      const pts = i.storyPoints ?? 3;
      if (total + pts > capacity) continue;
      picked.push(i);
      total += pts;
    }
    const unestimated = backlog.filter((i) => i.storyPoints == null).length;
    return {
      text: [
        `**Suggested next sprint** — target ${capacity} points ${velocity.length ? `(average of your last ${velocity.length} sprint${velocity.length === 1 ? '' : 's'})` : '(a sensible default until you have velocity data)'}:`,
        '',
        ...(picked.length ? picked.map((i) => `• **${i.key}** ${i.title} — ${i.storyPoints ?? '~3'} pts, ${i.priority}`) : ['• The backlog is empty — capture some work first.']),
        picked.length ? `\nTotal: ${total} points. Leave ~15% headroom for bugs and surprises.` : '',
        unestimated ? `\n${unestimated} backlog item${unestimated === 1 ? ' has' : 's have'} no estimate; I counted them as 3 points.` : '',
      ].filter(Boolean).join('\n'),
      actions: [{ type: 'navigate', label: 'Open backlog', payload: { to: `p/${c.project.key}/backlog` } }],
      suggestions: ['How do sprints work?', 'What needs attention?'],
    };
  }

  function summary(c) {
    const all = c.issues.filter((i) => i.type !== 'epic');
    const done = all.filter((i) => i.statusCategory === 'done').length;
    const progress = all.filter((i) => i.statusCategory === 'progress').length;
    const overdue = c.open.filter((i) => i.dueDate && i.dueDate < c.today).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const week = all.filter((i) => i.resolvedAt && daysBetween(i.resolvedAt.slice(0, 10), c.today) <= 7).length;
    const next = c.open.filter((i) => i.dueDate && i.dueDate >= c.today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
    let sprintLine = '';
    if (c.sprint) {
      const s = all.filter((i) => i.sprintId === c.sprint.id);
      const sd = s.filter((i) => i.statusCategory === 'done').length;
      sprintLine = `\n**${c.sprint.name}**: ${sd}/${s.length} done${c.sprint.end_date ? `, ends ${fmt(c.sprint.end_date, c.locale)}` : ''}${c.sprint.goal ? ` — goal: “${c.sprint.goal}”` : ''}.`;
    }
    const mood = overdue === 0 ? 'On track 🌿' : overdue <= 2 ? 'Mostly on track — a couple of items need a nudge.' : 'At risk — several items are overdue.';
    return {
      text: [
        `**${c.project ? c.project.name : c.ws.name} at a glance** — ${mood}`,
        '',
        `• ${pct}% complete (${done} of ${all.length} items)`,
        `• ${progress} in progress · ${overdue} overdue`,
        `• ${week} finished in the last 7 days`,
        sprintLine,
        next.length ? `\n**Coming up**\n${next.map((i) => `• ${fmt(i.dueDate, c.locale)} — **${i.key}** ${i.title}`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      actions: c.project ? [{ type: 'navigate', label: 'Open reports', payload: { to: `p/${c.project.key}/reports` } }] : [],
      suggestions: ['What needs attention?', 'Write my stand-up'],
    };
  }

  async function standup(c) {
    const since = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    const moved = (await db.all(
      `SELECT DISTINCT a.issue_id FROM activity a WHERE a.actor_id = ? AND a.workspace_id = ? AND a.created_at >= ? AND a.issue_id IS NOT NULL`,
      c.user.id, c.ws.id, since,
    )).map((r) => r.issue_id);
    const touched = c.issues.filter((i) => moved.includes(i.id));
    const finished = touched.filter((i) => i.statusCategory === 'done');
    const doing = c.open.filter((i) => i.assigneeId === c.user.id && i.statusCategory === 'progress');
    const blocked = c.open.filter((i) => i.assigneeId === c.user.id && c.blockedIds.has(i.id));
    const line = (i) => `• ${i.key} ${i.title}`;
    return {
      text: [
        '**Your stand-up, ready to paste:**',
        '',
        '**Yesterday**',
        finished.length ? finished.map(line).join('\n') : touched.length ? touched.slice(0, 4).map(line).join('\n') : '• Planning and catching up',
        '',
        '**Today**',
        doing.length ? doing.slice(0, 4).map(line).join('\n') : '• Picking up the next priority from the board',
        '',
        '**Blockers**',
        blocked.length ? blocked.map(line).join('\n') : '• None 🎉',
      ].join('\n'),
      suggestions: ['Prioritise my day', 'What needs attention?'],
      copyable: true,
    };
  }

  function howTo(c, q) {
    const qw = new Set(words(q));
    const scored = ARTICLES.map((a) => {
      const kw = a.keywords.split(' ');
      let score = 0;
      for (const w of qw) {
        if (kw.includes(w)) score += 3;
        else if (kw.some((k) => k.startsWith(w) || w.startsWith(k))) score += 1;
        if (a.title.toLowerCase().includes(w)) score += 1;
      }
      return { a, score };
    }).filter((s) => s.score > 0).sort((x, y) => y.score - x.score);
    if (!scored.length) return null;
    const best = scored[0].a;
    const projectPath = c.project ? `p/${c.project.key}` : null;
    const to = best.to?.startsWith(':project') ? (projectPath ? best.to.replace(':project', projectPath) : null) : best.to;
    return {
      text: `**${best.title}**\n\n${best.body}`,
      actions: to ? [{ type: 'navigate', label: 'Take me there', payload: { to } }] : [],
      suggestions: scored.slice(1, 4).map((s) => s.a.title),
    };
  }

  function fallback(c) {
    return {
      text: `I’m not sure I understood that one. Here’s what I’m great at:\n\n• **Planning** — “prioritise my day”, “plan the next sprint”\n• **Spotting issues** — “what needs attention?”, “who has too much on?”\n• **Doing** — “create a bug: export fails, urgent, assign to me”, “remind me to call Sam”\n• **Showing you around** — “how do WIP limits work?”`,
      suggestions: ['Prioritise my day', 'What needs attention?', 'Summarise the project', 'How do I invite people?'],
    };
  }

  async function ask({ user, ws, projectId, question }) {
    const q = String(question).trim();
    const c = await context(user, ws, projectId);
    const intent = intents.find((i) => i.test.test(q));
    let answer = intent ? await intent.run(c, q) : howTo(c, q);
    const openEnded = !intent && !answer;
    answer ??= fallback(c);
    answer.source = 'builtin';
    if (llm && openEnded) {
      const enriched = await llm.complete({ question: q, context: digest(c) }).catch(() => null);
      if (enriched) answer = { ...answer, text: enriched, source: 'local-model' };
    }
    return { suggestions: [], actions: [], ...answer };
  }

  /** Compact, non-identifying project digest handed to an optional local model. */
  function digest(c) {
    return {
      workspace: c.ws.name, project: c.project?.name ?? null, today: c.today,
      open: c.open.slice(0, 40).map((i) => ({ key: i.key, title: i.title, status: i.statusName, priority: i.priority, due: i.dueDate, assignee: c.name(i.assigneeId) })),
      methodology: c.project ? methodology(c.project.methodology).name : null,
      features: ARTICLES.map((a) => a.title),
    };
  }

  return { ask };
}

/** Optional: self-hosted Ollama keeps AI free with no third-party data sharing. */
export function createOllama({ url, model, timeoutMs = 12_000 }) {
  return {
    async complete({ question, context }) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
          method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, stream: false,
            messages: [
              { role: 'system', content: 'You are Flow guide, the friendly assistant inside Flowstate, a free project management tool. Use British English. Be concise (under 150 words), practical and warm. Use **bold** for key terms and bullet points with •. Only use facts from the provided workspace data.' },
              { role: 'user', content: `Workspace data: ${JSON.stringify(context)}\n\nQuestion: ${question}` },
            ],
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.message?.content?.trim() || null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
