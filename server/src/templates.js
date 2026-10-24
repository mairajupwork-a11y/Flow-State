/** Colours, plus starter work for each methodology so nobody faces an empty project. */

// Atelier palette: copper, sage, dusk blue, ochre, plum, sea, terracotta, mocha.
export const PROJECT_COLORS = ['#a65a2e', '#6f8a68', '#9c6b4e', '#c58f2c', '#7d7a4a', '#c48a64', '#b9563a', '#8c6d4f'];
export const USER_COLORS = ['#8a4a24', '#9c6b4e', '#6f8a68', '#b9563a', '#7d7a4a', '#c58f2c', '#c48a64', '#a0705a'];

/**
 * Starter work per methodology.
 * [type, title, statusIndex, priority, label, dueOffsetDays, estimate, checklist[], description, phaseIndex?, inSprint?]
 * Status indexes refer to the methodology's default columns; phase indexes to its phases.
 */
export const SAMPLE_WORK = {
  scrum: [
    ['epic', 'Launch the new customer experience', 1, 'high', 'Roadmap', 28, null, [], 'The big outcome this project is working towards. Link stories to it to track progress.'],
    ['story', 'Design new landing page layout', 1, 'high', 'Design', 2, 5, ['Outline requirements', 'Prepare draft', 'Review with team'], 'Refresh the homepage with clearer messaging and a welcoming visual hierarchy.', null, true],
    ['task', 'Build reusable UI component library', 1, 'medium', 'Development', 4, 8, ['Buttons', 'Inputs', 'Cards', 'Docs'], 'Create accessible buttons, inputs and cards for the new experience.', null, true],
    ['story', 'Write onboarding welcome content', 0, 'medium', 'Content', 3, 3, [], 'Help first-time visitors understand the product quickly.', null, true],
    ['task', 'Audit current user journeys', 0, 'high', 'Research', 1, 3, ['List journeys', 'Score friction'], 'Review the existing flows and identify the highest-friction moments.', null, true],
    ['bug', 'Fix sign-in validation errors', 2, 'urgent', 'Bug', 0, 2, [], 'Make sign-in errors visible, contextual and actionable.', null, true],
    ['task', 'Define mobile breakpoints', 2, 'medium', 'Design', 5, 2, [], 'Document mobile layouts and interaction patterns.', null, true],
    ['story', 'Map navigation structure', 3, 'medium', 'UX', -2, 5, ['Card sort', 'Tree test'], 'Simplify information architecture to reduce cognitive load.', null, true],
    ['task', 'Stakeholder kickoff & alignment', 3, 'low', 'Planning', -5, 1, [], 'Agree success metrics, scope and decision-making process.', null, true],
    ['task', 'Accessibility contrast review', 0, 'high', 'QA', 6, 2, [], 'Check text, states and controls against WCAG 2.2 guidance.', null, true],
    ['task', 'Finalise SEO page structure', 0, 'low', 'Content', null, 2, [], 'Prepare headings and metadata for key pages.'],
    ['task', 'Prototype responsive dashboard', 0, 'high', 'Design', null, 5, [], 'Design laptop, tablet and mobile-first layouts.'],
  ],
  scrumban: [
    ['epic', 'Mobile app v1 launch', 2, 'high', 'Roadmap', 35, null, [], 'Ship the first public version of the iOS and Android app.'],
    ['story', 'Onboarding screens & sign-up flow', 2, 'high', 'Mobile', 3, 5, ['Wireframes', 'Build screens', 'Analytics events'], 'Three-step onboarding with email and Apple/Google sign-in.', null, true],
    ['story', 'Push notification service', 1, 'high', 'Backend', 6, 8, ['Provider setup', 'Token storage', 'Opt-in prompt'], 'Send transactional and reminder notifications.', null, true],
    ['task', 'Offline mode for task list', 1, 'medium', 'Mobile', 9, 5, [], 'Cache the last sync and queue edits while offline.', null, true],
    ['bug', 'Crash when rotating on Android 14', 3, 'urgent', 'Bug', 1, 2, [], 'Reproducible on Pixel 8 when rotating during image upload.', null, true],
    ['story', 'In-app purchase for Pro plan', 0, 'medium', 'Payments', 14, 8, [], 'StoreKit 2 and Google Play Billing integration.'],
    ['task', 'Set up CI builds for TestFlight', 4, 'medium', 'DevOps', -3, 3, ['Signing', 'Pipeline', 'Release notes'], 'Automatic builds on every merge to main.', null, true],
    ['task', 'App Store screenshots & listing', 0, 'low', 'Marketing', 21, 2, [], 'Localised screenshots for UK, US and Singapore.'],
    ['bug', 'Dark mode contrast on settings screen', 1, 'medium', 'Bug', 4, 1, [], 'Secondary text fails WCAG AA in dark mode.', null, true],
    ['task', 'Accessibility pass (VoiceOver/TalkBack)', 0, 'high', 'QA', 12, 3, [], 'Label every control and test the main journeys.'],
  ],
  kanban: [
    ['task', 'Document project intake process', 2, 'high', 'Process', 3, null, ['Draft form', 'Agree triage rules'], 'Standardise the way new requests arrive.'],
    ['task', 'Refresh onboarding checklist', 1, 'medium', 'People', 8, null, [], 'Improve the first-week experience for new joiners.'],
    ['bug', 'Shared drive permissions are inconsistent', 3, 'urgent', 'IT', 1, null, [], 'Some teams cannot open the templates folder.'],
    ['task', 'Consolidate reporting templates', 4, 'low', 'Operations', -4, null, [], 'Reduce duplicate reporting across departments.'],
    ['task', 'Plan quarterly team offsite', 0, 'medium', 'Events', 14, null, ['Shortlist venues', 'Budget sign-off'], ''],
    ['bug', 'VPN drops for remote staff', 2, 'urgent', 'IT', 0, null, [], 'Affects users on the new laptops since Monday.'],
    ['task', 'Renew software licences', 0, 'high', 'Finance', 10, null, [], 'Five licences expire next month.'],
  ],
  lean: [
    ['epic', 'Self-serve customer onboarding', 2, 'high', 'Value stream', 40, null, [], 'Cut time-to-first-value for new customers from 9 days to 2.'],
    ['story', 'Experiment: guided setup checklist', 3, 'high', 'Activation', 5, null, ['Hypothesis', 'Build MVP', 'Measure activation'], 'If new users see a 5-step checklist, activation will rise by 15%.'],
    ['story', 'Experiment: remove credit card step', 4, 'medium', 'Conversion', -3, null, [], 'Learned: sign-ups +22%, no rise in spam accounts.'],
    ['story', 'Experiment: welcome video', 1, 'low', 'Activation', 12, null, [], 'Test whether a 60-second video reduces support tickets.'],
    ['task', 'Map current onboarding value stream', 4, 'high', 'Analysis', -6, null, [], 'Seven steps, two hand-offs, 6 days of waiting.'],
    ['task', 'Automate account provisioning', 2, 'high', 'Automation', 8, null, [], 'Removes a 2-day wait for manual set-up.'],
    ['story', 'Experiment: in-app chat for trials', 0, 'medium', 'Support', null, null, [], ''],
  ],
  waterfall: [
    ['epic', 'Customer portal go-live', 1, 'high', 'Deliverable', 70, null, [], 'Replace the legacy portal with the new self-service customer portal.', null],
    ['milestone', 'Requirements signed off', 3, 'high', 'Milestone', -8, null, [], '', 0],
    ['task', 'Gather stakeholder requirements', 3, 'high', 'Analysis', -12, 24, ['Interviews', 'Workshops', 'Requirements spec'], '', 0],
    ['task', 'Write functional specification', 3, 'medium', 'Analysis', -9, 16, [], '', 0],
    ['task', 'Solution architecture', 1, 'high', 'Architecture', 4, 20, ['Context diagram', 'Integrations', 'Security review'], '', 1],
    ['task', 'UI design & prototype', 1, 'high', 'Design', 6, 32, [], '', 1],
    ['milestone', 'Design approved', 0, 'high', 'Milestone', 10, null, [], '', 1],
    ['task', 'Build portal front end', 0, 'medium', 'Build', 28, 80, [], '', 2],
    ['task', 'Integrate with billing system', 0, 'high', 'Build', 32, 40, [], '', 2],
    ['task', 'System & UAT testing', 0, 'high', 'Testing', 44, 48, [], '', 3],
    ['task', 'Data migration & cut-over', 0, 'urgent', 'Deployment', 58, 24, [], '', 4],
    ['milestone', 'Go-live', 0, 'urgent', 'Milestone', 60, null, [], '', 4],
  ],
  sixsigma: [
    ['epic', 'Reduce order processing defects', 1, 'high', 'Workstream', 90, null, [], 'Cut order defects from 4.2% to under 1%.'],
    ['task', 'Draft project charter & SIPOC', 3, 'high', 'Define', -20, 6, [], '', 0],
    ['task', 'Voice of customer interviews', 3, 'medium', 'Define', -16, 8, [], '', 0],
    ['task', 'Data collection plan', 3, 'high', 'Measure', -6, 4, [], '', 1],
    ['task', 'Measurement system analysis (Gage R&R)', 1, 'high', 'Measure', 3, 6, ['Select operators', 'Run study', 'Assess %GRR'], '', 1],
    ['task', 'Establish baseline defect rate', 1, 'high', 'Measure', 5, 4, [], '', 1],
    ['task', 'Fishbone workshop', 0, 'medium', 'Analyse', 18, 4, [], '', 2],
    ['task', 'Hypothesis test: shift vs defect rate', 0, 'medium', 'Analyse', 24, 6, [], '', 2],
    ['task', 'Pilot error-proofing at order entry', 0, 'high', 'Improve', 45, 16, [], '', 3],
    ['task', 'Control plan & SPC chart', 0, 'high', 'Control', 75, 8, [], '', 4],
  ],
  prince2: [
    ['epic', 'New CRM system', 1, 'high', 'Product', 120, null, [], 'Business-wide CRM replacing three legacy tools.'],
    ['story', 'Project brief & outline business case', 3, 'high', 'Starting up', -25, 16, [], '', 0],
    ['milestone', 'Authorise initiation', 3, 'high', 'Board', -21, null, [], '', 0],
    ['story', 'Project Initiation Documentation (PID)', 1, 'high', 'Initiation', 4, 40, ['Risk strategy', 'Quality strategy', 'Communication strategy', 'Project plan'], '', 1],
    ['story', 'Supplier selection', 1, 'high', 'Initiation', 8, 24, [], '', 1],
    ['milestone', 'Authorise the project', 0, 'high', 'Board', 10, null, [], '', 1],
    ['story', 'WP1: Data migration design', 0, 'medium', 'Delivery', 40, 60, [], '', 2],
    ['story', 'WP2: Sales pipeline configuration', 0, 'medium', 'Delivery', 55, 80, [], '', 2],
    ['story', 'WP3: Training & rollout', 0, 'medium', 'Delivery', 95, 60, [], '', 3],
    ['story', 'End project report & lessons', 0, 'low', 'Closing', 118, 12, [], '', 4],
  ],
  business: [
    ['task', 'Approve campaign messaging', 0, 'high', 'Content', 2, null, [], 'Finalise cross-channel copy for the launch.'],
    ['task', 'Design social campaign templates', 1, 'medium', 'Creative', 5, null, ['Instagram', 'LinkedIn'], 'Create reusable asset templates.'],
    ['task', 'Book launch event venue', 2, 'high', 'Events', 3, null, [], 'Two options are awaiting budget approval.'],
    ['task', 'Set launch KPIs', 3, 'medium', 'Analytics', -3, null, [], 'Agree performance measurement and reporting.'],
  ],
};

/** Register entries, charter values and measurements seeded with example work. */
export const SAMPLE_GOVERNANCE = {
  waterfall: {
    charter: { objective: 'Launch a self-service customer portal that cuts support calls by 30%.', scope: 'Account management, billing, support tickets', outOfScope: 'Mobile apps', budget: 180000 },
    entries: [
      ['risk', 'Billing API documentation is incomplete', 'Open', { probability: 4, impact: 4, response: 'Reduce', mitigation: 'Book a technical workshop with the billing vendor.' }],
      ['risk', 'Key designer on leave during Design phase', 'Mitigating', { probability: 3, impact: 3, response: 'Reduce', mitigation: 'Contractor on standby.' }],
      ['change', 'Add Welsh language support', 'Requested', { impactSchedule: 10, impactCost: 12000 }],
    ],
  },
  sixsigma: {
    charter: { problem: '4.2% of orders contain at least one defect, causing returns and rework.', goal: 'Reduce order defects from 4.2% to below 1% by end of Q2.', scope: 'Order received → order dispatched', ctq: 'Order defect rate', unit: '%', direction: 'Lower', baseline: 4.2, target: 1, lsl: 0, usl: 5, benefit: 240000 },
    measurements: [4.4, 4.1, 4.6, 3.9, 4.3, 4.2, 4.5, 4.0, 3.8, 4.1, 3.6, 3.4],
    entries: [
      ['fmea', 'Wrong SKU keyed at order entry', 'Action planned', { failureMode: 'Manual SKU entry', effect: 'Wrong item shipped', severity: 8, occurrence: 6, detection: 5, action: 'Barcode scanning at entry' }],
      ['fmea', 'Address validation skipped', 'Open', { failureMode: 'Validation bypass', effect: 'Failed delivery', severity: 7, occurrence: 4, detection: 6, action: 'Make validation mandatory' }],
    ],
  },
  prince2: {
    charter: { reasons: 'Three legacy tools cause duplicate data and lost sales.', benefits: '10% more qualified leads; single customer view.', cost: 450000, timescale: '6 months', tolTime: 14, tolCost: 10, tolScope: 'Must-have requirements only', tolQuality: 'Zero critical defects at go-live' },
    entries: [
      ['risk', 'Supplier capacity during peak season', 'Open', { probability: 3, impact: 4, response: 'Transfer', mitigation: 'Penalty clause in contract.' }],
      ['issue', 'Sales team requests extra pipeline stage', 'With Project Board', { issueType: 'Request for change', priority: 'Should', severity: 'Medium' }],
      ['quality', 'PID quality review', 'Passed', { product: 'Project Initiation Documentation', method: 'Review' }],
      ['lesson', 'Engage end users before supplier demos', 'Captured', { category: 'Process', recommendation: 'Run user workshops before shortlisting suppliers.' }],
    ],
  },
  lean: {
    charter: { customer: 'New business customers', value: 'Getting their team productive on day one', valueStream: 'Sign up → provisioning → set-up call → first project → first value', leadTimeTarget: 2, flowTarget: 40 },
    entries: [
      ['waste', 'Waiting for manual account provisioning', 'Countermeasure', { wasteType: 'Waiting', hoursLost: 16, countermeasure: 'Automate provisioning via API.' }],
      ['waste', 'Set-up call re-asks sign-up questions', 'Spotted', { wasteType: 'Extra processing', hoursLost: 4 }],
      ['kaizen', 'Pre-fill workspace from sign-up answers', 'Trialling', { benefit: 'Saves 10 minutes per customer', effort: 'Small' }],
    ],
  },
  scrumban: { entries: [['impediment', 'Waiting on Apple developer account approval', 'Escalated', { blocking: 'TestFlight distribution' }]] },
  scrum: { entries: [['impediment', 'Staging environment unstable', 'Open', { blocking: 'QA of sign-in fixes' }]] },
};
