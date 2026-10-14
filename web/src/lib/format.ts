import type { IssueType, Priority, Locale } from './types';

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayISO = () => isoDay();
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 864e5);
}

export function fmtDate(iso: string | null | undefined, locale: Locale | string = 'en-GB', withYear = false): string {
  if (!iso) return 'No date';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** "Today", "Tomorrow", "Yesterday", or a short date. */
export function relativeDay(iso: string | null, locale: Locale | string = 'en-GB'): string {
  if (!iso) return 'No date';
  const diff = daysBetween(todayISO(), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDate(iso, locale);
}

/** Server timestamps are UTC "YYYY-MM-DD HH:MM:SS" or ISO strings. */
export function timeAgo(ts: string): string {
  const t = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
export const TYPES: IssueType[] = ['task', 'story', 'bug', 'feature', 'epic', 'subtask'];
export const TYPE_LABEL: Record<IssueType, string> = { epic: 'Epic', feature: 'Feature', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Sub-task' };
export const TYPE_ICON: Record<IssueType, string> = { epic: 'bolt', feature: 'target', story: 'sparkles', task: 'checkcircle', bug: 'flag', subtask: 'list' };

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, word: string, many = word + 's') => `${n} ${n === 1 ? word : many}`;
