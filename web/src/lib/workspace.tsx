import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IS_DEMO } from './api';
import type { Me, Member, Project, Workspace, Locale } from './types';

interface WorkspaceCtx {
  workspace: Workspace;
  me: Me;
  members: Member[];
  projects: Project[];
  locale: Locale;
  canEdit: boolean;
  isAdmin: boolean;
  member: (id: number | null | undefined) => Member | undefined;
  base: string; // e.g. /w/studio-north
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ value, children }: { value: Omit<WorkspaceCtx, 'member' | 'canEdit' | 'isAdmin' | 'base' | 'locale'>; children: ReactNode }) {
  const ctx = useMemo<WorkspaceCtx>(() => {
    const byId = new Map(value.members.map((m) => [m.id, m]));
    return {
      ...value,
      locale: value.me.locale || value.workspace.locale,
      canEdit: value.workspace.role !== 'viewer',
      isAdmin: value.workspace.role === 'admin',
      member: (id) => (id == null ? undefined : byId.get(id)),
      base: `/w/${value.workspace.slug}`,
    };
  }, [value]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useWs(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWs must be used inside WorkspaceProvider');
  return ctx;
}

/** Subscribes to server-sent change hints and refreshes affected queries (debounced). */
export function useRealtime(slug: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (IS_DEMO || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/workspaces/${slug}/events`);
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      for (const scope of pending) {
        if (scope === 'issues') for (const k of ['issues', 'my-issues', 'reports', 'activity']) qc.invalidateQueries({ queryKey: [k] });
        else if (scope === 'workspace') { qc.invalidateQueries({ queryKey: ['ws'] }); qc.invalidateQueries({ queryKey: ['invites'] }); }
        else if (scope === 'notifications') qc.invalidateQueries({ queryKey: ['notifications'] });
        else if (scope.startsWith('project:')) qc.invalidateQueries({ queryKey: ['project', Number(scope.slice(8))] });
        else if (scope.startsWith('issue:')) qc.invalidateQueries({ queryKey: ['issue'] });
      }
      pending.clear();
    };
    es.onmessage = (e) => {
      try {
        const { scope } = JSON.parse(e.data) as { scope: string[] };
        scope.forEach((s) => pending.add(s));
        clearTimeout(timer);
        timer = setTimeout(flush, 250);
      } catch {
        /* ignore malformed hints */
      }
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [slug, qc]);
}

/** The project in the URL, else the last one visited, else the first. */
export function useCurrentProject(activeKey?: string) {
  const { projects, workspace } = useWs();
  let key = activeKey;
  if (!key) {
    try {
      key = localStorage.getItem(`fs_last_project_${workspace.slug}`) ?? undefined;
    } catch {
      /* storage blocked */
    }
  }
  return projects.find((p) => p.key === key) ?? projects[0];
}
