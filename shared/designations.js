/**
 * Designations (job titles) in tech teams, grouped for the invite and team
 * dropdowns. Anything else can be typed in via "Other".
 *
 * Each group also says which access level that job usually gets:
 *  - manager: plans the work — creates cards, edits project details, sets dates and assigns people.
 *  - member:  does the work — comments, uploads files, adds links and moves their cards along.
 * Admins can always choose a different access level for any one person.
 */
export const DESIGNATION_GROUPS = [
  ['Leadership', ['CEO', 'CTO', 'COO', 'CFO', 'CPO (Chief Product Officer)', 'Founder / Co-founder', 'Managing Director', 'General Manager', 'VP of Engineering', 'Director of Engineering', 'Head of Product', 'Head of Design', 'Head of QA', 'Head of Marketing', 'Head of AI']],
  ['Project, Product & Program Management', ['Project Manager', 'Associate Project Manager', 'Technical Project Manager', 'Project Coordinator', 'Product Manager', 'Associate Product Manager', 'Product Owner', 'Program Manager', 'Portfolio Manager', 'PMO Lead', 'Delivery Manager', 'Engineering Manager', 'Scrum Master', 'Agile Coach', 'Business Analyst', 'Operations Manager', 'Account Manager']],
  ['Team Leads', ['Team Lead – Development', 'Team Lead – Design', 'Team Lead – Production', 'Team Lead – Marketing', 'Team Lead – AI', 'Team Lead – QA', 'Team Lead – DevOps', 'Team Lead – Data', 'Team Lead – Support', 'Tech Lead']],
  ['Engineering', ['Full-Stack Developer', 'MERN Stack Developer', 'MEAN Stack Developer', 'Frontend Developer', 'Backend Developer', 'Software Engineer', 'Senior Software Engineer', 'Software Architect', 'Solutions Architect', 'React Developer', 'Angular Developer', 'Vue.js Developer', 'Node.js Developer', 'Python Developer', 'Java Developer', '.NET Developer', 'PHP / Laravel Developer', 'WordPress Developer', 'Shopify Developer', 'Game Developer', 'Blockchain Developer', 'Embedded Systems Engineer']],
  ['Mobile', ['Mobile App Developer', 'iOS Developer', 'Android Developer', 'Flutter Developer', 'React Native Developer']],
  ['AI & Data', ['AI Engineer', 'Machine Learning Engineer', 'Prompt Engineer', 'LLM / GenAI Engineer', 'Computer Vision Engineer', 'NLP Engineer', 'Data Scientist', 'Data Engineer', 'Data Analyst', 'BI Developer']],
  ['DevOps & Infrastructure', ['DevOps Engineer', 'Site Reliability Engineer (SRE)', 'Cloud Engineer', 'Database Administrator', 'System Administrator', 'Network Engineer']],
  ['Quality & Security', ['QA Engineer', 'Automation Test Engineer', 'Manual QA Tester', 'Security Engineer', 'Penetration Tester']],
  ['Design', ['UI/UX Designer', 'Product Designer', 'UX Researcher', 'Graphic Designer', 'Motion Designer', '3D Artist', 'Illustrator']],
  ['Production & Content', ['Video Editor', 'Video Producer', 'Content Producer', 'Content Writer', 'Copywriter', 'Technical Writer', 'Social Media Producer']],
  ['Marketing & Growth', ['Marketing Executive', 'Digital Marketing Specialist', 'Performance Marketer', 'SEO Specialist', 'Social Media Manager', 'Email Marketing Specialist', 'Growth Marketer', 'Community Manager']],
  ['Business & Operations', ['Business Development Manager', 'Sales Executive', 'HR Manager', 'Recruiter', 'Finance / Accountant', 'Customer Support', 'Customer Success Manager']],
  ['Other', ['Consultant', 'Freelancer / Contractor', 'Intern', 'Trainee', 'Client / Stakeholder']],
];

export const DESIGNATIONS = DESIGNATION_GROUPS.flatMap(([, list]) => list);

/** Groups whose people plan and assign the work. */
const MANAGEMENT_GROUPS = new Set(['Leadership', 'Project, Product & Program Management', 'Team Leads']);
const EXTRA_MANAGEMENT = ['Business Development Manager', 'HR Manager', 'Social Media Manager', 'Customer Success Manager'];
export const MANAGEMENT_DESIGNATIONS = [
  ...DESIGNATION_GROUPS.filter(([g]) => MANAGEMENT_GROUPS.has(g)).flatMap(([, list]) => list),
  ...EXTRA_MANAGEMENT,
];

/** Access level that usually fits a designation: "manager" for people who run projects, else "member". */
export function accessForDesignation(designation) {
  const d = String(designation ?? '').trim().toLowerCase();
  if (!d) return 'member';
  if (MANAGEMENT_DESIGNATIONS.some((m) => m.toLowerCase() === d)) return 'manager';
  if (d === 'client / stakeholder') return 'viewer';
  return /\b(manager|lead|head|director|chief|owner|coordinator|analyst|founder|ceo|cto|coo|cfo|cpo|vp)\b/.test(d) ? 'manager' : 'member';
}

/** The four access levels, highest first. */
export const ACCESS_LEVELS = [
  { id: 'admin', label: 'Admin', blurb: 'Everything, including people, roles and workspace settings.' },
  { id: 'manager', label: 'Manager', blurb: 'Sees every project. Creates and edits cards, project details and dates, and assigns people.' },
  { id: 'member', label: 'Team member', blurb: 'Sees the projects they’re on. Comments, uploads files, adds links and moves cards. Can’t change dates, assignees or descriptions.' },
  { id: 'viewer', label: 'Viewer', blurb: 'Read-only access to the projects they’re on.' },
];
