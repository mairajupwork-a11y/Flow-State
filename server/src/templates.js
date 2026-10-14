/** Workflow presets offered during onboarding and project creation. */
export const TEMPLATES = {
  scrum: {
    label: 'Scrum',
    statuses: [
      ['To do', 'todo', '#9698ab'],
      ['In progress', 'progress', '#6a8ee9'],
      ['In review', 'progress', '#edaf5b'],
      ['Done', 'done', '#28b391'],
    ],
  },
  kanban: {
    label: 'Kanban',
    statuses: [
      ['To do', 'todo', '#9698ab', null],
      ['In progress', 'progress', '#6a8ee9', 5],
      ['In review', 'progress', '#edaf5b', 3],
      ['Done', 'done', '#28b391', null],
    ],
  },
  business: {
    label: 'Business',
    statuses: [
      ['Requested', 'todo', '#9698ab'],
      ['Working on it', 'progress', '#6a8ee9'],
      ['Awaiting approval', 'progress', '#edaf5b'],
      ['Complete', 'done', '#28b391'],
    ],
  },
};

export const PROJECT_COLORS = ['#7770e7', '#30adab', '#f09d75', '#9e8bb6', '#e5789a', '#5b9be0', '#d6a347', '#4fb38a'];
export const USER_COLORS = ['#6e6ad7', '#e99b83', '#59a8b0', '#dba961', '#967bbd', '#64a68e', '#d97a9a', '#5b8fd6'];

/**
 * Starter work for a new project, so nobody faces an empty board.
 * [type, title, statusIndex, priority, label, dueOffsetDays, points, checklist[], description]
 */
export const SAMPLE_WORK = {
  scrum: [
    ['epic', 'Launch the new customer experience', 1, 'high', 'Roadmap', 28, null, [], 'The big outcome this project is working towards. Link stories to it to track progress.'],
    ['story', 'Design new landing page layout', 1, 'high', 'Design', 2, 5, ['Outline requirements', 'Prepare draft', 'Review with team'], 'Refresh the homepage with clearer messaging and a welcoming visual hierarchy.'],
    ['task', 'Build reusable UI component library', 1, 'medium', 'Development', 4, 8, ['Buttons', 'Inputs', 'Cards', 'Docs'], 'Create accessible buttons, inputs and cards for the new experience.'],
    ['story', 'Write onboarding welcome content', 0, 'medium', 'Content', 3, 3, [], 'Help first-time visitors understand the product quickly.'],
    ['task', 'Audit current user journeys', 0, 'high', 'Research', 1, 3, ['List journeys', 'Score friction'], 'Review the existing flows and identify the highest-friction moments.'],
    ['bug', 'Fix sign-in validation errors', 2, 'urgent', 'Bug', 0, 2, [], 'Make sign-in errors visible, contextual and actionable.'],
    ['task', 'Define mobile breakpoints', 2, 'medium', 'Design', 5, 2, [], 'Document mobile layouts and interaction patterns.'],
    ['story', 'Map navigation structure', 3, 'medium', 'UX', -2, 5, ['Card sort', 'Tree test'], 'Simplify information architecture to reduce cognitive load.'],
    ['task', 'Stakeholder kickoff & alignment', 3, 'low', 'Planning', -5, 1, [], 'Agree success metrics, scope and decision-making process.'],
    ['task', 'Accessibility contrast review', 0, 'high', 'QA', 6, 2, [], 'Check text, states and controls against WCAG 2.2 guidance.'],
  ],
  kanban: [
    ['task', 'Document project intake process', 1, 'high', 'Process', 3, null, ['Draft form', 'Agree triage rules'], 'Standardise the way new requests arrive.'],
    ['task', 'Refresh onboarding checklist', 0, 'medium', 'People', 8, null, [], 'Improve the first-week experience for new joiners.'],
    ['bug', 'Shared drive permissions are inconsistent', 2, 'urgent', 'IT', 1, null, [], 'Some teams cannot open the templates folder.'],
    ['task', 'Consolidate reporting templates', 3, 'low', 'Operations', -4, null, [], 'Reduce duplicate reporting across departments.'],
    ['task', 'Plan quarterly team offsite', 0, 'medium', 'Events', 14, null, ['Shortlist venues', 'Budget sign-off'], ''],
  ],
  business: [
    ['task', 'Approve campaign messaging', 0, 'high', 'Content', 2, null, [], 'Finalise cross-channel copy for the launch.'],
    ['task', 'Design social campaign templates', 1, 'medium', 'Creative', 5, null, ['Instagram', 'LinkedIn'], 'Create reusable asset templates.'],
    ['task', 'Book launch event venue', 2, 'high', 'Events', 3, null, [], 'Two options are awaiting budget approval.'],
    ['task', 'Set launch KPIs', 3, 'medium', 'Analytics', -3, null, [], 'Agree performance measurement and reporting.'],
  ],
};
