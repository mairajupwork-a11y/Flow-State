export type Role = 'admin' | 'member' | 'viewer';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';
export type IssueType = 'epic' | 'feature' | 'story' | 'task' | 'bug' | 'subtask' | 'milestone';
export type StatusCategory = 'todo' | 'progress' | 'done';
export type Template = 'scrum' | 'kanban' | 'business';
export type { MethodologyId } from '../../../shared/methodologies.js';
import type { MethodologyId } from '../../../shared/methodologies.js';
export type Locale = 'en-GB' | 'en-US' | 'en-IN' | 'en-SG' | 'en-AU';
export type Theme = 'light' | 'dark' | 'system';
export type TimeBlock = 'morning' | 'afternoon' | 'evening' | 'anytime';

export interface User { id: number; name: string; email: string; initials: string; color: string; jobTitle: string }
export type NotifyPref = 'all' | 'important' | 'off';
export interface Me extends User { locale: Locale; theme: Theme; hasPassword?: boolean; notifyEmail?: NotifyPref; notifyPush?: NotifyPref }
export interface Member extends User { role: Role; joinedAt: string }

export interface Workspace {
  id: number; name: string; slug: string; region: 'uk' | 'us' | 'asia' | 'other'; locale: Locale; weekStart: 0 | 1;
  teamSize: string; useCase: string; role: Role; createdAt: string;
}

export interface Session { user: Me | null; workspaces: Workspace[] }

export interface Project {
  id: number; workspaceId: number; key: string; name: string; description: string; color: string; template: Template;
  methodology: MethodologyId; settings: ProjectSettings;
  leadId: number | null; archived: boolean; createdAt: string; issueCount?: number; doneCount?: number;
}
export interface Status { id: number; name: string; category: StatusCategory; color: string; position: number; wipLimit: number | null }
export interface Sprint {
  id: number; projectId: number; name: string; goal: string; state: 'planned' | 'active' | 'closed';
  startDate: string | null; endDate: string | null; completedAt: string | null; committedPoints: number | null; completedPoints: number | null;
}
export type FieldValues = Record<string, string | number | null>;
export interface ProjectSettings { charter?: FieldValues; swimlane?: 'none' | 'priority' | 'assignee' | 'epic' }
export type PhaseState = 'pending' | 'active' | 'review' | 'complete';
export interface Phase {
  id: number; projectId: number; name: string; position: number; state: PhaseState; gate: string; decision: string;
  startDate: string | null; endDate: string | null; startedAt: string | null; completedAt: string | null; approvedBy: number | null;
}
export interface Entry {
  id: number; projectId: number; kind: string; title: string; status: string; ownerId: number | null; data: FieldValues;
  createdBy: number | null; createdAt: string; updatedAt: string;
}
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'person';
export interface CustomField { id: number; projectId: number; name: string; type: FieldType; options: string[]; position: number }
export type CustomValue = string | number | boolean | string[] | null;
export interface ProjectDetail extends Project { statuses: Status[]; sprints: Sprint[]; phases: Phase[]; fields: CustomField[] }
export interface Attachment { id: number; issueId: number; name: string; mime: string; size: number; uploaderId: number | null; uploaderName: string | null; createdAt: string; url: string }
export type TriggerEvent = 'created' | 'status' | 'assigned' | 'priority' | 'comment' | 'due_soon' | 'overdue';
export type ActionKind = 'notify' | 'assign' | 'priority' | 'label' | 'move' | 'comment' | 'due';
export interface AutomationWhen { event: TriggerEvent; statusId?: number; userId?: number; priority?: Priority; days?: number; filter?: { type?: string; priority?: Priority; label?: string } }
export interface AutomationAction { action: ActionKind; to?: (number | 'assignee' | 'reporter' | 'watchers')[]; message?: string; userId?: number | 'reporter' | null; priority?: Priority; label?: string; statusId?: number; text?: string; days?: number }
export interface Automation { id: number; projectId: number; name: string; when: AutomationWhen; then: AutomationAction[]; enabled: boolean; runCount: number; lastRunAt: string | null; createdBy: number | null; createdAt: string }
export interface NotifySettings { email: NotifyPref; push: NotifyPref; devices: number; emailAvailable: boolean; pushAvailable: boolean; pushKey: string | null; calendarUrl: string | null; calendarReachable: boolean }

export interface WorkspaceDetail { workspace: Workspace; members: Member[]; projects: Project[] }

export interface Issue {
  id: number; key: string; number: number; projectId: number; type: IssueType; title: string; description: string;
  statusId: number; statusName: string; statusCategory: StatusCategory; priority: Priority;
  assigneeId: number | null; reporterId: number | null; sprintId: number | null; epicId: number | null; parentId: number | null;
  phaseId: number | null; storyPoints: number | null; startDate: string | null; dueDate: string | null; labels: string[]; rank: number;
  createdAt: string; updatedAt: string; resolvedAt: string | null;
  checklistTotal: number; checklistDone: number; commentCount: number; subtaskCount: number; attachmentCount?: number;
}

export interface Comment { id: number; body: string; createdAt: string; editedAt: string | null; authorId: number | null; author: User | null }
export interface Activity { id: number; verb: string; data: Record<string, unknown>; createdAt: string; actorId: number | null; issueId: number | null; issueKey: string | null; issueTitle: string | null }
export interface IssueLink { id: number; kind: 'blocks' | 'relates' | 'duplicates'; direction: 'inward' | 'outward'; issue: Issue }
export interface IssueDetail extends Issue {
  checklist: { id: number; text: string; done: boolean }[];
  comments: Comment[]; subtasks: Issue[]; children: Issue[]; links: IssueLink[]; activity: Activity[]; watchers: number[];
  attachments: Attachment[]; fields: Record<string, CustomValue>;
}

export interface Todo {
  id: number; text: string; note: string; done: boolean; important: boolean; day: string; timeBlock: TimeBlock;
  issueId: number | null; issueKey: string | null; position: number; createdAt: string; completedAt: string | null;
}
export interface TodoDay { day: string; items: Todo[]; history: { day: string; total: number; done: number }[] }

export interface Notification {
  id: number; kind: string; text: string; read: boolean; createdAt: string; issueId: number | null; issueKey: string | null;
  actor: { name: string; color: string; initials: string } | null;
}

export interface Reports {
  totals: { total: number; done: number; inProgress: number; overdue: number; cycleTimeDays: number | null };
  byStatus: { id: number; name: string; color: string; category: StatusCategory; count: number; points: number }[];
  byPriority: { priority: Priority; count: number }[];
  byType: { type: IssueType; count: number }[];
  workload: { userId: number | null; name: string; open: number; points: number; overdue: number }[];
  flow: { day: string; created: number; resolved: number }[];
  burndown: null | { sprint: Sprint; unit: 'points' | 'items'; total: number; points: { day: string; ideal: number; remaining: number | null }[] };
  velocity: { name: string; committed: number; completed: number }[];
  cfd: { statuses: { name: string; color: string; category: StatusCategory }[]; days: { day: string; counts: Record<string, number> }[] };
  cycle: { samples: { key: string; title: string; resolved: string; cycle: number; lead: number; efficiency: number | null }[]; avgCycle: number | null; p50: number | null; p85: number | null; avgLead: number | null };
  throughput: { week: string; count: number }[];
  efficiency: { average: number | null; wip: number; littleLeadDays: number | null; byStatus: { name: string; waiting: boolean; count: number }[] };
  phases: { id: number; name: string; state: PhaseState; startDate: string | null; endDate: string | null; total: number; done: number; percent: number; late: boolean }[];
  control: { points: { id: number; day: string; value: number; note: string }[]; mean: number | null; ucl: number | null; lcl: number | null; sigma: number | null;
    lsl?: number | null; usl?: number | null; cp: number | null; cpk: number | null; sigmaLevel: number | null; signals: { index: number; rule: string }[] };
  registers: { kind: string; label: string; total: number; open: number; high: number }[];
}

export type GuideAction =
  | { type: 'create_issue'; label: string; payload: { projectId: number; title: string; type: IssueType; priority: Priority; assigneeId: number | null; dueDate: string | null; labels: string[] } }
  | { type: 'add_todo'; label: string; payload: { text: string } }
  | { type: 'plan_day'; label: string; payload: { items: { text: string; issueRef: string }[] } }
  | { type: 'open_issue'; label: string; payload: { key: string } }
  | { type: 'navigate'; label: string; payload: { to: string } };

export interface GuideAnswer { text: string; suggestions: string[]; actions: GuideAction[]; source: 'builtin' | 'local-model'; copyable?: boolean }
