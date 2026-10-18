/**
 * Common designations in software development firms, grouped for the invite
 * dropdown. Anything else can be typed in via "Other".
 */
export const DESIGNATION_GROUPS = [
  ['Leadership', ['CEO', 'CTO', 'COO', 'CFO', 'CPO (Chief Product Officer)', 'Founder / Co-founder', 'Managing Director', 'General Manager', 'VP of Engineering', 'Director of Engineering', 'Head of Product', 'Head of Design', 'Head of QA']],
  ['Project & Product Management', ['Project Manager', 'Technical Project Manager', 'Product Manager', 'Product Owner', 'Program Manager', 'Delivery Manager', 'Engineering Manager', 'Scrum Master', 'Agile Coach', 'Business Analyst', 'Operations Manager', 'Account Manager']],
  ['Engineering', ['Full-Stack Developer', 'MERN Stack Developer', 'MEAN Stack Developer', 'Frontend Developer', 'Backend Developer', 'Software Engineer', 'Senior Software Engineer', 'Tech Lead', 'Software Architect', 'Solutions Architect', 'React Developer', 'Angular Developer', 'Vue.js Developer', 'Node.js Developer', 'Python Developer', 'Java Developer', '.NET Developer', 'PHP / Laravel Developer', 'WordPress Developer', 'Shopify Developer', 'Game Developer', 'Blockchain Developer', 'Embedded Systems Engineer']],
  ['Mobile', ['Mobile App Developer', 'iOS Developer', 'Android Developer', 'Flutter Developer', 'React Native Developer']],
  ['Data & AI', ['Data Scientist', 'Data Engineer', 'Data Analyst', 'Machine Learning Engineer', 'AI Engineer', 'BI Developer']],
  ['DevOps & Infrastructure', ['DevOps Engineer', 'Site Reliability Engineer (SRE)', 'Cloud Engineer', 'Database Administrator', 'System Administrator', 'Network Engineer']],
  ['Quality & Security', ['QA Engineer', 'Automation Test Engineer', 'Manual QA Tester', 'Security Engineer']],
  ['Design', ['UI/UX Designer', 'Product Designer', 'UX Researcher', 'Graphic Designer', 'Motion Designer']],
  ['Business & Operations', ['Business Development Manager', 'Sales Executive', 'Marketing Manager', 'Digital Marketing Specialist', 'SEO Specialist', 'Content Writer', 'Technical Writer', 'HR Manager', 'Recruiter', 'Finance / Accountant', 'Customer Support']],
  ['Other', ['Consultant', 'Freelancer / Contractor', 'Intern', 'Trainee', 'Client / Stakeholder']],
];

export const DESIGNATIONS = DESIGNATION_GROUPS.flatMap(([, list]) => list);
