import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Avatar } from './ui';
import type { Member } from '../lib/types';

/**
 * Pick several people with checkboxes. People already on the project are listed first;
 * choosing anyone else also adds them to the project.
 */
export function AssigneePicker({ value, onChange, members, projectMemberIds, meId, disabled = false, label = 'Assignees' }: {
  value: number[]; onChange: (ids: number[]) => void; members: Member[]; projectMemberIds?: number[]; meId?: number; disabled?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const people = members.filter((m) => m.role !== 'viewer');
  const onProject = new Set(projectMemberIds ?? people.map((m) => m.id));
  const match = (m: Member) => !q.trim() || `${m.name} ${m.jobTitle}`.toLowerCase().includes(q.trim().toLowerCase());
  const groups = useMemo(() => [
    ['On this project', people.filter((m) => onProject.has(m.id) && match(m))],
    ['Others in the workspace', people.filter((m) => !onProject.has(m.id) && match(m))],
  ] as const, [people, q, projectMemberIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = value.map((id) => members.find((m) => m.id === id)).filter(Boolean) as Member[];
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="assignee-picker" ref={box}>
      <button type="button" className="assignee-trigger" disabled={disabled} aria-expanded={open} aria-label={label}
        onClick={() => setOpen((o) => !o)}>
        {chosen.length ? (
          <span className="assignee-chips">
            {chosen.slice(0, 3).map((m) => <span key={m.id} className="assignee-chip"><Avatar user={m} size="sm" /> {m.name.split(' ')[0]}</span>)}
            {chosen.length > 3 && <span className="assignee-chip more">+{chosen.length - 3}</span>}
          </span>
        ) : <span className="muted-inline">Unassigned</span>}
        {!disabled && <Icon name="chevron" size={14} />}
      </button>
      {open && !disabled && (
        <div className="assignee-pop" role="dialog" aria-label={`Choose ${label.toLowerCase()}`}>
          <input className="text-input slim" autoFocus placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }} />
          <div className="assignee-list">
            {groups.map(([title, list]) => list.length > 0 && (
              <div key={title}>
                <div className="assignee-group">{title}</div>
                {list.map((m) => (
                  <label key={m.id} className="assignee-option">
                    <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} />
                    <Avatar user={m} size="sm" />
                    <span className="assignee-name"><b>{m.name}{m.id === meId ? ' (you)' : ''}</b><small>{m.jobTitle || roleName(m.role)}</small></span>
                  </label>
                ))}
              </div>
            ))}
            {groups.every(([, l]) => !l.length) && <p className="tiny-note" style={{ padding: 10 }}>No one matches “{q}”.</p>}
          </div>
          <div className="assignee-foot">
            <button type="button" className="link-btn" onClick={() => onChange([])}>Clear</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

export const roleName = (role: string) => ({ admin: 'Admin', manager: 'Manager', member: 'Team member', viewer: 'Viewer' }[role] ?? role);
