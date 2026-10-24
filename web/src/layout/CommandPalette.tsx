import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../components/Icon';
import { Avatar, TypeIcon } from '../components/ui';
import { api } from '../lib/api';
import { useWs, useCurrentProject } from '../lib/workspace';
import { openCreate, openGuide, ui } from '../lib/store';
import { setTheme } from '../lib/theme';
import type { Issue, Project, User } from '../lib/types';
import { methodologyOf, viewMeta } from '../lib/methodology';

interface Item { id: string; icon: React.ReactNode; label: string; hint?: string; group: string; run: () => void }

function useDebounced<T>(value: T, ms = 160) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ routeKey, onClose }: { routeKey?: string; onClose: () => void }) {
  const { workspace, base, projects, canEdit } = useWs();
  const project = useCurrentProject(routeKey);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ['search', workspace.slug, debounced],
    queryFn: () => api.get<{ issues: Issue[]; projects: Project[]; people: User[] }>(`/workspaces/${workspace.slug}/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    placeholderData: (prev) => prev,
  });

  const go = (to: string) => () => { onClose(); navigate(to); };
  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase();
    const p = project ? `${base}/p/${project.key}` : null;
    const commands: Item[] = [
      ...(canEdit ? [{ id: 'create', icon: <Icon name="plus" size={16} />, label: q.trim() ? `Create work item “${q.trim()}”` : 'Create work item', hint: 'C', group: 'Actions', run: () => { onClose(); openCreate({ title: q.trim() || undefined }); } }] : []),
      { id: 'guide', icon: <Icon name="sparkles" size={16} />, label: q.trim() ? `Ask the Mars guide: “${q.trim()}”` : 'Ask the Mars guide', group: 'Actions', run: () => { onClose(); openGuide(q.trim() || null); } },
      ...(p ? [
        ...methodologyOf(project).views.map((v) => {
          const meta = viewMeta(methodologyOf(project), v);
          const hint = ({ board: 'G B', backlog: 'G L', reports: 'G R' } as Record<string, string>)[v];
          return { id: `view-${v}`, icon: <Icon name={meta.icon} size={16} />, label: `${project!.name} · ${meta.label}`, hint, group: 'Go to', run: go(`${p}/${v}`) };
        }),
      ] : []),
      { id: 'home', icon: <Icon name="grid" size={16} />, label: 'Overview', hint: 'G H', group: 'Go to', run: go(base) },
      { id: 'mytasks', icon: <Icon name="checkcircle" size={16} />, label: 'My tasks', hint: 'G T', group: 'Go to', run: go(`${base}/my-tasks`) },
      { id: 'myday', icon: <Icon name="sun" size={16} />, label: 'My day', hint: 'G D', group: 'Go to', run: go(`${base}/my-day`) },
      { id: 'team', icon: <Icon name="people" size={16} />, label: 'Team', hint: 'G M', group: 'Go to', run: go(`${base}/team`) },
      { id: 'settings', icon: <Icon name="settings" size={16} />, label: 'Settings', hint: 'G S', group: 'Go to', run: go(`${base}/settings`) },
      ...(canEdit ? [
        { id: 'newproject', icon: <Icon name="folder" size={16} />, label: 'Create project', group: 'Actions', run: () => { onClose(); ui.set({ createProjectOpen: true }); } },
        { id: 'invite', icon: <Icon name="mail" size={16} />, label: 'Invite people (free, unlimited)', group: 'Actions', run: () => { onClose(); ui.set({ inviteOpen: true }); } },
      ] : []),
      { id: 'dark', icon: <Icon name="moon" size={16} />, label: 'Switch to dark theme', group: 'Preferences', run: () => { setTheme('dark'); onClose(); } },
      { id: 'light', icon: <Icon name="sun" size={16} />, label: 'Switch to light theme', group: 'Preferences', run: () => { setTheme('light'); onClose(); } },
      { id: 'keys', icon: <Icon name="keyboard" size={16} />, label: 'Keyboard shortcuts', hint: '?', group: 'Preferences', run: () => { onClose(); ui.set({ shortcutsOpen: true }); } },
    ];
    const projectItems: Item[] = projects.map((pr) => ({ id: `p${pr.id}`, icon: <span className="project-glyph sm" style={{ background: pr.color }}>{pr.name[0]}</span>, label: pr.name, hint: pr.key, group: 'Projects', run: go(`${base}/p/${pr.key}`) }));
    const matches = (s: string) => !ql || s.toLowerCase().includes(ql);
    const issues: Item[] = (debounced ? search.data?.issues ?? [] : []).map((i) => ({
      id: `i${i.id}`, icon: <TypeIcon type={i.type} size={13} />, label: i.title, hint: i.key, group: 'Work items',
      run: () => { onClose(); navigate(`?issue=${i.key}`); },
    }));
    const people: Item[] = (debounced ? search.data?.people ?? [] : []).map((u) => ({ id: `u${u.id}`, icon: <Avatar user={u} size="sm" />, label: u.name, hint: u.email, group: 'People', run: go(`${base}/team`) }));
    const alwaysFirst = commands.filter((c) => c.id === 'create' || c.id === 'guide');
    const rest = [...projectItems, ...commands.filter((c) => c.id !== 'create' && c.id !== 'guide')].filter((c) => matches(c.label));
    return ql ? [...issues, ...rest, ...people, ...alwaysFirst] : [...alwaysFirst, ...rest];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, debounced, search.data, projects, project, base, canEdit]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work, projects and people — or type a command…"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pi-${items[active].id}` : undefined} />
          {search.isFetching && <span className="spinner sm" />}
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="palette-group" key={`g-${item.group}`}>{item.group}</div> : null;
            lastGroup = item.group;
            return (
              <div key={item.id} style={{ display: 'contents' }}>
                {header}
                <button id={`pi-${item.id}`} data-index={i} role="option" aria-selected={i === active} className={`palette-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={item.run}>
                  <span className="palette-icon">{item.icon}</span>
                  <span className="ellipsis" style={{ flex: 1 }}>{item.label}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                </button>
              </div>
            );
          })}
          {debounced && !search.isFetching && !items.some((i) => i.group === 'Work items') && <div className="palette-empty">No work items match “{debounced}”.</div>}
        </div>
        <div className="palette-foot"><span><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span><span><span className="kbd">↵</span> select</span><span><span className="kbd">Esc</span> close</span></div>
      </div>
    </div>,
    document.body,
  );
}
