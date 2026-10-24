import { CHARTERS, REGISTERS, methodology, term } from '../../../shared/methodologies.js';
import type { Methodology, ViewId } from '../../../shared/methodologies.js';
import type { IssueType, Project } from './types';
import { TYPE_LABEL } from './format';

export * from '../../../shared/methodologies.js';
export type * from '../../../shared/methodologies.js';

export const methodologyOf = (p: Pick<Project, 'methodology' | 'template'> | null | undefined): Methodology => methodology(p?.methodology ?? p?.template);

const CHARTER_SHORT: Record<string, string> = { waterfall: 'Definition', sixsigma: 'Charter', prince2: 'Business case', lean: 'Value' };

/** Navigation label and icon for a project view, in the methodology's own words. */
export function viewMeta(m: Methodology, view: ViewId | string): { label: string; icon: string } {
  switch (view) {
    case 'board': return { label: m.phases ? 'Board' : m.features.wip ? 'Flow board' : 'Board', icon: 'board' };
    case 'backlog': return { label: 'Backlog', icon: 'inbox' };
    case 'list': return { label: 'List', icon: 'list' };
    case 'timeline': return { label: m.phases ? 'Gantt' : 'Timeline', icon: 'timeline' };
    case 'calendar': return { label: 'Calendar', icon: 'calendar' };
    case 'reports': return { label: 'Reports', icon: 'chart' };
    case 'phases': return { label: term(m.id, 'phases'), icon: 'layers' };
    case 'registers': return { label: registersLabel(m), icon: 'shield' };
    case 'charter': return { label: (m.charter && CHARTER_SHORT[m.charter]) || 'Charter', icon: m.charter ? CHARTERS[m.charter].icon : 'folder' };
    case 'settings': return { label: 'Settings', icon: 'settings' };
    default: return { label: view, icon: 'grid' };
  }
}

function registersLabel(m: Methodology) {
  if (m.registers.length === 1) return REGISTERS[m.registers[0]].label.replace(/ register| log/i, '') || 'Register';
  if (m.id === 'lean') return 'Waste & kaizen';
  if (m.id === 'sixsigma') return 'FMEA & lessons';
  return 'Registers';
}

/** Work item type name under the project's methodology (e.g. PRINCE2 "Work package"). */
export const typeLabel = (m: Methodology, type: IssueType) => m.terms[type] ?? TYPE_LABEL[type];
export const estimateLabel = (m: Methodology) => (m.features.estimation === 'hours' ? 'Estimate (hours)' : m.features.estimation === 'none' ? 'Size' : 'Story points');
export const estimateUnit = (m: Methodology) => (m.features.estimation === 'hours' ? 'h' : 'pts');
export const gateWord = (m: Methodology) => (m.features.phases === 'dmaic' ? 'tollgate' : m.features.phases === 'stage' ? 'stage boundary' : 'gate');
/** Lower-cases a term for use mid-sentence, keeping acronyms such as DMAIC. */
export const lower = (s: string) => s.replace(/\b(?![A-Z0-9]{2,}\b)\w+/g, (w) => w.toLowerCase());
export const sprintWord = (m: Methodology) => term(m.id, 'sprint');

export const FAMILY_COLOR: Record<string, string> = { Agile: '#8dabc6', Hybrid: '#da9a75', Predictive: '#4f8e85', Quality: '#e0b468', Governance: '#d59388', Simple: '#b29f8f' };
