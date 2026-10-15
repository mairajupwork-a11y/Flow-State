/**
 * Methodology engine — the single source of truth for how each delivery
 * practice behaves in Flowstate. Shared by the API (project creation,
 * validation, reports, AI guide) and the web app (views, boards, terms).
 *
 * Each methodology declares:
 *  - statuses  : default board columns [name, category, colour, wipLimit]
 *  - phases    : sequential phases/stages with gate (exit) criteria, or null
 *  - features  : which mechanics are on (sprints, WIP, phases, swimlanes…)
 *  - types     : which work item types exist, and `terms` renames them
 *  - registers : governance logs (risk, issue, lessons, waste…)
 *  - charter   : the project definition document fields
 *  - views     : project navigation, in order
 *  - metrics   : report widgets that suit the practice
 *  - ceremonies: the rhythm the team follows (shown as guidance)
 */

const C = { grey: '#9698ab', blue: '#6a8ee9', amber: '#edaf5b', green: '#28b391', violet: '#8278f4', rose: '#e5789a', teal: '#30adab' };

const probability = { key: 'probability', label: 'Probability', type: 'scale', min: 1, max: 5, hint: '1 rare · 5 almost certain' };
const impact = { key: 'impact', label: 'Impact', type: 'scale', min: 1, max: 5, hint: '1 minimal · 5 severe' };
const owner = { key: 'owner', label: 'Owner', type: 'member' };
const notes = { key: 'details', label: 'Details', type: 'textarea' };

const RISK_REGISTER = {
  kind: 'risk', label: 'Risk register', icon: 'shield', score: 'pxi',
  statuses: ['Open', 'Mitigating', 'Closed'],
  fields: [probability, impact, { key: 'response', label: 'Response', type: 'select', options: ['Avoid', 'Reduce', 'Transfer', 'Accept', 'Exploit'] }, owner, { key: 'mitigation', label: 'Mitigation plan', type: 'textarea' }],
};

export const REGISTERS = {
  risk: RISK_REGISTER,
  fmea: {
    kind: 'fmea', label: 'FMEA (risk)', icon: 'shield', score: 'rpn',
    statuses: ['Open', 'Action planned', 'Verified'],
    fields: [
      { key: 'failureMode', label: 'Failure mode', type: 'text' },
      { key: 'effect', label: 'Effect', type: 'text' },
      { key: 'severity', label: 'Severity', type: 'scale', min: 1, max: 10 },
      { key: 'occurrence', label: 'Occurrence', type: 'scale', min: 1, max: 10 },
      { key: 'detection', label: 'Detection', type: 'scale', min: 1, max: 10, hint: '1 certain to detect · 10 undetectable' },
      { key: 'action', label: 'Recommended action', type: 'textarea' }, owner,
    ],
  },
  issue: {
    kind: 'issue', label: 'Issue register', icon: 'flag',
    statuses: ['Open', 'With Project Board', 'Resolved'],
    fields: [
      { key: 'issueType', label: 'Type', type: 'select', options: ['Request for change', 'Off-specification', 'Problem / concern'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Must', 'Should', 'Could', "Won't"] },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'Medium', 'High', 'Exceeds tolerance'] }, owner, notes,
    ],
  },
  change: {
    kind: 'change', label: 'Change log', icon: 'refresh',
    statuses: ['Requested', 'Approved', 'Rejected', 'Implemented'],
    fields: [{ key: 'impactSchedule', label: 'Schedule impact (days)', type: 'number' }, { key: 'impactCost', label: 'Cost impact (£)', type: 'number' }, owner, notes],
  },
  lesson: {
    kind: 'lesson', label: 'Lessons log', icon: 'lightbulb',
    statuses: ['Captured', 'Shared', 'Embedded'],
    fields: [{ key: 'category', label: 'Category', type: 'select', options: ['Went well', 'To improve', 'Process', 'Technical', 'People'] }, { key: 'recommendation', label: 'Recommendation', type: 'textarea' }, owner],
  },
  quality: {
    kind: 'quality', label: 'Quality register', icon: 'checkcircle',
    statuses: ['Planned', 'In review', 'Passed', 'Failed'],
    fields: [{ key: 'product', label: 'Product', type: 'text' }, { key: 'method', label: 'Quality method', type: 'select', options: ['Review', 'Test', 'Inspection', 'Demonstration'] }, { key: 'reviewer', label: 'Reviewer', type: 'member' }, { key: 'reviewDate', label: 'Review date', type: 'date' }, notes],
  },
  waste: {
    kind: 'waste', label: 'Waste log', icon: 'trash',
    statuses: ['Spotted', 'Countermeasure', 'Eliminated'],
    fields: [
      { key: 'wasteType', label: 'Waste type', type: 'select', options: ['Defects', 'Overproduction', 'Waiting', 'Non-utilised talent', 'Transportation', 'Inventory', 'Motion', 'Extra processing'] },
      { key: 'hoursLost', label: 'Hours lost per week', type: 'number' }, { key: 'countermeasure', label: 'Countermeasure', type: 'textarea' }, owner,
    ],
  },
  kaizen: {
    kind: 'kaizen', label: 'Kaizen ideas', icon: 'sparkles',
    statuses: ['Idea', 'Trialling', 'Standardised', 'Dropped'],
    fields: [{ key: 'benefit', label: 'Expected benefit', type: 'textarea' }, { key: 'effort', label: 'Effort', type: 'select', options: ['Small', 'Medium', 'Large'] }, owner],
  },
  impediment: {
    kind: 'impediment', label: 'Impediments', icon: 'flag',
    statuses: ['Open', 'Escalated', 'Removed'],
    fields: [{ key: 'blocking', label: 'What it blocks', type: 'text' }, owner, notes],
  },
};

export const CHARTERS = {
  waterfall: {
    title: 'Project definition', icon: 'folder',
    fields: [
      { key: 'objective', label: 'Objective', type: 'textarea' },
      { key: 'scope', label: 'In scope', type: 'textarea' },
      { key: 'outOfScope', label: 'Out of scope', type: 'textarea' },
      { key: 'budget', label: 'Budget (£)', type: 'number' },
      { key: 'deadline', label: 'Target go-live', type: 'date' },
      { key: 'sponsor', label: 'Sponsor', type: 'member' },
      { key: 'acceptance', label: 'Acceptance criteria', type: 'textarea' },
    ],
  },
  sixsigma: {
    title: 'Project charter', icon: 'target',
    fields: [
      { key: 'problem', label: 'Problem statement', type: 'textarea', hint: 'What, where, when, how big — no causes or solutions.' },
      { key: 'goal', label: 'Goal statement', type: 'textarea', hint: 'SMART: reduce X from baseline to target by date.' },
      { key: 'scope', label: 'Process scope (start → end)', type: 'text' },
      { key: 'ctq', label: 'CTQ metric', type: 'text', hint: 'Critical-to-quality measure, e.g. “Order defects”.' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'direction', label: 'Better is', type: 'select', options: ['Lower', 'Higher'] },
      { key: 'baseline', label: 'Baseline', type: 'number' },
      { key: 'target', label: 'Target', type: 'number' },
      { key: 'lsl', label: 'Lower spec limit (LSL)', type: 'number' },
      { key: 'usl', label: 'Upper spec limit (USL)', type: 'number' },
      { key: 'benefit', label: 'Expected annual benefit (£)', type: 'number' },
      { key: 'champion', label: 'Champion', type: 'member' },
      { key: 'belt', label: 'Black / Green Belt', type: 'member' },
    ],
  },
  prince2: {
    title: 'Business case & PID', icon: 'shield',
    fields: [
      { key: 'reasons', label: 'Reasons (why this project)', type: 'textarea' },
      { key: 'options', label: 'Options considered', type: 'textarea' },
      { key: 'benefits', label: 'Expected benefits', type: 'textarea' },
      { key: 'disbenefits', label: 'Expected dis-benefits', type: 'textarea' },
      { key: 'cost', label: 'Cost (£)', type: 'number' },
      { key: 'timescale', label: 'Timescale', type: 'text' },
      { key: 'tolTime', label: 'Time tolerance (± days)', type: 'number' },
      { key: 'tolCost', label: 'Cost tolerance (± %)', type: 'number' },
      { key: 'tolScope', label: 'Scope tolerance', type: 'text' },
      { key: 'tolQuality', label: 'Quality tolerance', type: 'text' },
      { key: 'executive', label: 'Executive', type: 'member' },
      { key: 'seniorUser', label: 'Senior User', type: 'member' },
      { key: 'seniorSupplier', label: 'Senior Supplier', type: 'member' },
      { key: 'projectManager', label: 'Project Manager', type: 'member' },
      { key: 'assurance', label: 'Project Assurance', type: 'member' },
    ],
  },
  lean: {
    title: 'Value definition', icon: 'heart',
    fields: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'value', label: 'What the customer values', type: 'textarea' },
      { key: 'valueStream', label: 'Value stream (steps from request to delivery)', type: 'textarea' },
      { key: 'leadTimeTarget', label: 'Lead time target (days)', type: 'number' },
      { key: 'flowTarget', label: 'Flow efficiency target (%)', type: 'number' },
    ],
  },
};

const AGILE_TYPES = ['epic', 'story', 'task', 'bug', 'subtask'];
const BASE_TERMS = {
  epic: 'Epic', feature: 'Feature', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Sub-task', milestone: 'Milestone',
  sprint: 'Sprint', phase: 'Phase', phases: 'Phases', item: 'Work item', points: 'Story points',
};

export const METHODOLOGIES = {
  scrum: {
    id: 'scrum', name: 'Scrum', family: 'Agile', icon: 'inbox',
    tagline: 'Deliver in short, timeboxed sprints.',
    description: 'A prioritised backlog is pulled into fixed-length sprints. The team commits to a sprint goal, inspects progress daily and improves every sprint.',
    bestFor: ['Product & software teams', 'Requirements that evolve', 'Frequent releases'],
    scale: 'Teams of 3–9 (scale with multiple teams)', cadence: '1–4 week sprints',
    statuses: [['To do', 'todo', C.grey], ['In progress', 'progress', C.blue], ['In review', 'progress', C.amber], ['Done', 'done', C.green]],
    phases: null,
    features: { sprints: 'required', backlog: true, wip: false, phases: false, swimlane: 'none', estimation: 'points' },
    types: AGILE_TYPES, terms: {},
    registers: ['impediment'], charter: null,
    views: ['board', 'backlog', 'list', 'timeline', 'calendar', 'reports', 'registers', 'settings'],
    metrics: ['burndown', 'velocity', 'flow', 'workload', 'status', 'priority'],
    ceremonies: ['Sprint planning', 'Daily scrum (15 min)', 'Sprint review', 'Sprint retrospective', 'Backlog refinement'],
  },
  kanban: {
    id: 'kanban', name: 'Kanban', family: 'Agile', icon: 'board',
    tagline: 'Continuous flow with WIP limits.',
    description: 'Work is pulled through the board as capacity frees up. WIP limits stop overload, an expedite lane handles urgent work, and flow metrics drive improvement.',
    bestFor: ['Support & operations', 'Unpredictable incoming work', 'Continuous delivery'],
    scale: 'Any team size', cadence: 'Continuous — replenish on demand',
    statuses: [['Backlog', 'todo', C.grey], ['Selected', 'todo', C.violet, 8], ['In progress', 'progress', C.blue, 5], ['Review', 'progress', C.amber, 3], ['Done', 'done', C.green]],
    phases: null,
    features: { sprints: false, backlog: false, wip: true, phases: false, swimlane: 'priority', estimation: 'none' },
    types: ['epic', 'task', 'bug', 'subtask'], terms: {},
    registers: [], charter: null,
    views: ['board', 'list', 'timeline', 'calendar', 'reports', 'settings'],
    metrics: ['cfd', 'cycle', 'throughput', 'workload', 'status', 'priority'],
    ceremonies: ['Replenishment meeting', 'Daily stand-up at the board', 'Service delivery review', 'Operations review'],
  },
  scrumban: {
    id: 'scrumban', name: 'Scrumban', family: 'Hybrid', icon: 'bolt',
    tagline: 'Kanban flow with Scrum rhythm.',
    description: 'A hybrid: work flows across a WIP-limited board with a “Ready” buffer, while optional iterations give a planning and review cadence. Plan on demand when Ready runs low.',
    bestFor: ['App & product development', 'Teams moving from Scrum to flow', 'Mixed planned + reactive work'],
    scale: 'Teams of 3–15', cadence: 'Optional 1–2 week iterations · on-demand planning',
    statuses: [['Backlog', 'todo', C.grey], ['Ready', 'todo', C.violet, 10], ['In progress', 'progress', C.blue, 4], ['Review', 'progress', C.amber, 3], ['Done', 'done', C.green]],
    phases: null,
    features: { sprints: 'optional', backlog: true, wip: true, phases: false, swimlane: 'priority', estimation: 'points' },
    types: AGILE_TYPES, terms: { sprint: 'Iteration' },
    registers: ['impediment'], charter: null,
    views: ['board', 'backlog', 'list', 'timeline', 'calendar', 'reports', 'registers', 'settings'],
    metrics: ['cfd', 'cycle', 'throughput', 'burndown', 'workload', 'status'],
    ceremonies: ['On-demand planning (when Ready drops below threshold)', 'Daily stand-up at the board', 'Iteration review', 'Retrospective'],
  },
  waterfall: {
    id: 'waterfall', name: 'Waterfall', family: 'Predictive', icon: 'timeline',
    tagline: 'Sequential phases with sign-off gates.',
    description: 'Requirements are fixed up front, then the project moves through phases in order. Each phase ends with a formal gate before the next begins, tracked on a Gantt timeline.',
    bestFor: ['Fixed scope & budget', 'Construction, hardware, compliance', 'Contract-based delivery'],
    scale: 'Medium to large projects', cadence: 'Phase by phase, gated',
    statuses: [['Not started', 'todo', C.grey], ['In progress', 'progress', C.blue], ['Blocked', 'progress', C.rose], ['Complete', 'done', C.green]],
    phases: [
      { name: 'Requirements', gate: 'Requirements specification signed off' },
      { name: 'Design', gate: 'Design approved by stakeholders' },
      { name: 'Implementation', gate: 'Build complete and unit tested' },
      { name: 'Testing', gate: 'System & user acceptance testing passed' },
      { name: 'Deployment', gate: 'Go-live approved' },
      { name: 'Maintenance', gate: 'Handover to operations accepted' },
    ],
    features: { sprints: false, backlog: false, wip: false, phases: 'phase', swimlane: 'none', estimation: 'hours' },
    types: ['epic', 'milestone', 'task', 'bug', 'subtask'], terms: { epic: 'Deliverable', bug: 'Defect', points: 'Estimate (hours)' },
    registers: ['risk', 'change'], charter: 'waterfall',
    views: ['phases', 'timeline', 'board', 'list', 'calendar', 'charter', 'registers', 'reports', 'settings'],
    metrics: ['phases', 'flow', 'workload', 'status', 'priority'],
    ceremonies: ['Kick-off', 'Phase gate reviews', 'Weekly status report', 'Change control board', 'Project closure'],
  },
  lean: {
    id: 'lean', name: 'Lean', family: 'Agile', icon: 'heart',
    tagline: 'Maximise value, eliminate waste.',
    description: 'Map the value stream, pull work through a build–measure–learn flow and remove the eight wastes. Flow efficiency and lead time show where value stalls.',
    bestFor: ['Start-ups & experiments', 'Process improvement', 'Service & operations teams'],
    scale: 'Any — scales across value streams', cadence: 'Continuous flow · regular kaizen',
    statuses: [['Ideas', 'todo', C.grey], ['Define value', 'todo', C.violet, 6], ['Build', 'progress', C.blue, 4], ['Measure', 'progress', C.amber, 3], ['Learned', 'done', C.green]],
    phases: null,
    features: { sprints: false, backlog: false, wip: true, phases: false, swimlane: 'none', estimation: 'none' },
    types: ['epic', 'story', 'task', 'bug', 'subtask'], terms: { epic: 'Value stream', story: 'Experiment', bug: 'Defect' },
    registers: ['waste', 'kaizen'], charter: 'lean',
    views: ['board', 'list', 'charter', 'registers', 'reports', 'timeline', 'calendar', 'settings'],
    metrics: ['cfd', 'cycle', 'efficiency', 'throughput', 'workload', 'status'],
    ceremonies: ['Gemba walk', 'Daily huddle', 'Kaizen event', 'Value stream review'],
  },
  sixsigma: {
    id: 'sixsigma', name: 'Six Sigma', family: 'Quality', icon: 'target',
    tagline: 'Data-driven DMAIC improvement.',
    description: 'Reduce variation and defects through Define, Measure, Analyse, Improve and Control. Each phase ends at a tollgate; progress is proven with data and control charts.',
    bestFor: ['Quality & defect reduction', 'Operations & manufacturing', 'Measurable process problems'],
    scale: 'Focused improvement projects (3–6 months)', cadence: 'DMAIC phases with tollgates',
    statuses: [['To do', 'todo', C.grey], ['In progress', 'progress', C.blue], ['Tollgate review', 'progress', C.amber], ['Done', 'done', C.green]],
    phases: [
      { name: 'Define', gate: 'Charter, SIPOC and voice of customer approved' },
      { name: 'Measure', gate: 'Baseline measured and data collection validated (MSA)' },
      { name: 'Analyse', gate: 'Root causes verified with data' },
      { name: 'Improve', gate: 'Solution piloted and improvement proven' },
      { name: 'Control', gate: 'Control plan handed over to process owner' },
    ],
    features: { sprints: false, backlog: false, wip: false, phases: 'dmaic', swimlane: 'none', estimation: 'hours' },
    types: ['epic', 'story', 'task', 'subtask'], terms: { epic: 'Workstream', story: 'Deliverable', task: 'Action', phase: 'DMAIC phase', phases: 'DMAIC' },
    registers: ['fmea', 'lesson'], charter: 'sixsigma',
    views: ['phases', 'board', 'charter', 'reports', 'registers', 'list', 'timeline', 'settings'],
    metrics: ['control', 'phases', 'workload', 'status'],
    ceremonies: ['Tollgate reviews', 'Data collection plan', 'Root cause workshops', 'Control plan handover'],
  },
  prince2: {
    id: 'prince2', name: 'PRINCE2', family: 'Governance', icon: 'shield',
    tagline: 'Controlled stages under a Project Board.',
    description: 'Driven by a business case, the project runs in management stages. The Project Board authorises each stage at its boundary; work is delegated as work packages within agreed tolerances.',
    bestFor: ['Public sector & regulated work', 'Large, multi-supplier projects', 'Formal governance'],
    scale: 'Medium to very large', cadence: 'Management stages · stage boundaries',
    statuses: [['Authorised', 'todo', C.grey], ['In progress', 'progress', C.blue], ['Quality review', 'progress', C.amber], ['Accepted', 'done', C.green]],
    phases: [
      { name: 'Starting up', gate: 'Project brief approved — authorise initiation' },
      { name: 'Initiation', gate: 'PID approved — authorise the project' },
      { name: 'Delivery stage 1', gate: 'End stage report accepted — authorise next stage' },
      { name: 'Delivery stage 2', gate: 'End stage report accepted — authorise closure' },
      { name: 'Closing', gate: 'End project report accepted — project closed' },
    ],
    features: { sprints: false, backlog: false, wip: false, phases: 'stage', swimlane: 'none', estimation: 'hours' },
    types: ['epic', 'story', 'task', 'milestone', 'subtask'], terms: { epic: 'Product', story: 'Work package', task: 'Activity', milestone: 'Stage boundary', subtask: 'Sub-activity', phase: 'Stage', phases: 'Stages' },
    registers: ['risk', 'issue', 'quality', 'lesson'], charter: 'prince2',
    views: ['phases', 'board', 'charter', 'registers', 'timeline', 'list', 'reports', 'settings'],
    metrics: ['phases', 'workload', 'status', 'priority'],
    ceremonies: ['Project Board meetings', 'Stage boundary reviews', 'Highlight reports', 'Checkpoint reports', 'End project report'],
  },
  business: {
    id: 'business', name: 'Simple workflow', family: 'Simple', icon: 'checkcircle',
    tagline: 'Requests and approvals, no jargon.',
    description: 'A plain request → approval flow for non-technical teams. No sprints, no ceremonies — just clear ownership and due dates.',
    bestFor: ['Marketing, HR, finance', 'Small internal projects', 'Teams new to project tools'],
    scale: 'Any', cadence: 'As needed',
    statuses: [['Requested', 'todo', C.grey], ['Working on it', 'progress', C.blue], ['Awaiting approval', 'progress', C.amber], ['Complete', 'done', C.green]],
    phases: null,
    features: { sprints: false, backlog: false, wip: false, phases: false, swimlane: 'none', estimation: 'none' },
    types: ['task', 'bug', 'subtask'], terms: { bug: 'Issue' },
    registers: [], charter: null,
    views: ['board', 'list', 'calendar', 'timeline', 'reports', 'settings'],
    metrics: ['flow', 'workload', 'status', 'priority'],
    ceremonies: ['Weekly check-in'],
  },
};

export const METHODOLOGY_IDS = Object.keys(METHODOLOGIES);
/** The seven practices offered first; "business" is the plain fallback. */
export const PRIMARY_METHODOLOGIES = ['waterfall', 'scrum', 'kanban', 'lean', 'sixsigma', 'prince2', 'scrumban'];

export function methodology(id) {
  return METHODOLOGIES[id] ?? METHODOLOGIES.business;
}

/** Display name for an item type or concept under a methodology. */
export function term(id, key) {
  return methodology(id).terms[key] ?? BASE_TERMS[key] ?? key;
}

/** Legacy `template` column value (kept for older databases and clients). */
export function legacyTemplate(id) {
  const m = methodology(id);
  return m.features.sprints === 'required' ? 'scrum' : m.features.wip ? 'kanban' : 'business';
}

/**
 * Recommends a methodology from a few plain questions.
 * answers: { requirements: 'fixed'|'evolving'|'unknown', work: 'project'|'product'|'stream'|'improve',
 *            governance: 'light'|'formal', size: 'small'|'medium'|'large', cadence: 'release'|'continuous'|'phased' }
 * Returns ranked [{ id, score, reasons[] }].
 */
export function recommend(a = {}) {
  const s = Object.fromEntries(PRIMARY_METHODOLOGIES.map((id) => [id, { id, score: 0, reasons: [] }]));
  const add = (id, n, why) => { s[id].score += n; if (why) s[id].reasons.push(why); };
  if (a.requirements === 'fixed') { add('waterfall', 3, 'Requirements are fixed up front'); add('prince2', 2, 'Stable scope suits staged control'); }
  if (a.requirements === 'evolving') { add('scrum', 3, 'Requirements will evolve'); add('scrumban', 3, 'Requirements will evolve'); add('kanban', 1); add('lean', 1); }
  if (a.requirements === 'unknown') { add('lean', 3, 'Value needs validating through experiments'); add('scrumban', 1); }
  if (a.work === 'product') { add('scrum', 2, 'Building a product'); add('scrumban', 3, 'Product build with mixed planned and reactive work'); }
  if (a.work === 'stream') { add('kanban', 3, 'A continuous stream of requests'); add('lean', 1); add('scrumban', 1); }
  if (a.work === 'improve') { add('sixsigma', 4, 'Improving a measurable process'); add('lean', 2, 'Removing waste from a process'); }
  if (a.work === 'project') { add('waterfall', 2, 'A one-off project with an end date'); add('prince2', 2, 'A defined project with a business case'); }
  if (a.governance === 'formal') { add('prince2', 3, 'Formal governance and board approvals'); add('waterfall', 1); add('sixsigma', 1); }
  if (a.governance === 'light') { add('kanban', 1); add('scrum', 1); add('scrumban', 1); add('lean', 1); }
  if (a.size === 'small') { add('kanban', 1, 'Small team — minimal overhead'); add('scrumban', 1); add('lean', 1); }
  if (a.size === 'large') { add('prince2', 2, 'Large scale needs staged control'); add('waterfall', 1); add('scrum', 1, 'Scrum scales across teams'); }
  if (a.cadence === 'release') { add('scrum', 2, 'Regular release cadence'); add('scrumban', 1); }
  if (a.cadence === 'continuous') { add('kanban', 2, 'Ship continuously'); add('scrumban', 1); add('lean', 1); }
  if (a.cadence === 'phased') { add('waterfall', 2, 'Delivery in sequential phases'); add('prince2', 2); add('sixsigma', 1); }
  return Object.values(s).sort((x, y) => y.score - x.score);
}
