export type MethodologyId = 'scrum' | 'kanban' | 'scrumban' | 'waterfall' | 'lean' | 'sixsigma' | 'prince2' | 'business';
export type ViewId = 'board' | 'backlog' | 'list' | 'timeline' | 'calendar' | 'reports' | 'registers' | 'phases' | 'charter' | 'settings';
export type MetricId = 'burndown' | 'velocity' | 'flow' | 'workload' | 'status' | 'priority' | 'cfd' | 'cycle' | 'throughput' | 'efficiency' | 'phases' | 'control';
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'member' | 'select' | 'scale';

export interface FieldDef { key: string; label: string; type: FieldType; options?: string[]; min?: number; max?: number; hint?: string }
export interface RegisterDef { kind: string; label: string; icon: string; score?: 'pxi' | 'rpn'; statuses: string[]; fields: FieldDef[] }
export interface CharterDef { title: string; icon: string; fields: FieldDef[] }
export interface PhaseDef { name: string; gate: string }

export interface Methodology {
  id: MethodologyId; name: string; family: string; icon: string; tagline: string; description: string;
  bestFor: string[]; scale: string; cadence: string;
  statuses: [string, 'todo' | 'progress' | 'done', string, number?][];
  phases: PhaseDef[] | null;
  features: { sprints: 'required' | 'optional' | false; backlog: boolean; wip: boolean; phases: 'phase' | 'dmaic' | 'stage' | false; swimlane: 'none' | 'priority' | 'assignee' | 'epic'; estimation: 'points' | 'hours' | 'none' };
  types: string[]; terms: Record<string, string>;
  registers: string[]; charter: string | null;
  views: ViewId[]; metrics: MetricId[]; ceremonies: string[];
}

export interface Recommendation { id: MethodologyId; score: number; reasons: string[] }

export const METHODOLOGIES: Record<MethodologyId, Methodology>;
export const METHODOLOGY_IDS: MethodologyId[];
export const PRIMARY_METHODOLOGIES: MethodologyId[];
export const REGISTERS: Record<string, RegisterDef>;
export const CHARTERS: Record<string, CharterDef>;
export function methodology(id: string | undefined): Methodology;
export function term(id: string | undefined, key: string): string;
export function legacyTemplate(id: string): 'scrum' | 'kanban' | 'business';
export function recommend(answers: Partial<Record<'requirements' | 'work' | 'governance' | 'size' | 'cadence', string>>): Recommendation[];
