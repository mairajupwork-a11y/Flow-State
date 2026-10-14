import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { toastError } from './store';
import type { Issue, IssueDetail, ProjectDetail, Reports, Session, TodoDay, Todo, WorkspaceDetail, Notification, Activity, Status } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (n, err) => n < 2 && (err as { status?: number }).status !== 404 && (err as { status?: number }).status !== 401, refetchOnWindowFocus: true },
    mutations: { onError: toastError },
  },
});

export const keys = {
  session: ['session'] as const,
  workspace: (slug: string) => ['ws', slug] as const,
  project: (id: number) => ['project', id] as const,
  issues: (projectId: number) => ['issues', projectId] as const,
  issue: (ref: string) => ['issue', ref] as const,
  myIssues: (slug: string) => ['my-issues', slug] as const,
  todos: (day: string) => ['todos', day] as const,
  notifications: (slug: string) => ['notifications', slug] as const,
  reports: (projectId: number) => ['reports', projectId] as const,
  activity: (slug: string) => ['activity', slug] as const,
};

export const useSession = () => useQuery({ queryKey: keys.session, queryFn: () => api.get<Session>('/auth/me'), staleTime: 60_000 });
export const useWorkspace = (slug: string) => useQuery({ queryKey: keys.workspace(slug), queryFn: () => api.get<WorkspaceDetail>(`/workspaces/${slug}`) });
export const useProject = (id: number | undefined) =>
  useQuery({ queryKey: keys.project(id ?? 0), queryFn: () => api.get<ProjectDetail>(`/projects/${id}`), enabled: !!id });
export const useIssues = (projectId: number | undefined) =>
  useQuery({ queryKey: keys.issues(projectId ?? 0), queryFn: () => api.get<Issue[]>(`/projects/${projectId}/issues`), enabled: !!projectId });
export const useIssue = (ref: string | null) =>
  useQuery({ queryKey: keys.issue(ref ?? ''), queryFn: () => api.get<IssueDetail>(`/issues/${ref}`), enabled: !!ref });
export const useMyIssues = (slug: string) => useQuery({ queryKey: keys.myIssues(slug), queryFn: () => api.get<Issue[]>(`/workspaces/${slug}/my-issues`) });
export const useTodos = (day: string) => useQuery({ queryKey: keys.todos(day), queryFn: () => api.get<TodoDay>(`/todos?day=${day}`) });
export const useNotifications = (slug: string) =>
  useQuery({ queryKey: keys.notifications(slug), queryFn: () => api.get<{ unread: number; items: Notification[] }>(`/notifications/${slug}`), refetchInterval: 120_000 });
export const useReports = (projectId: number | undefined) =>
  useQuery({ queryKey: keys.reports(projectId ?? 0), queryFn: () => api.get<Reports>(`/projects/${projectId}/reports`), enabled: !!projectId });
export const useActivity = (slug: string) => useQuery({ queryKey: keys.activity(slug), queryFn: () => api.get<Activity[]>(`/workspaces/${slug}/activity`) });

/** After any work-item change, refresh every view that derives from issues. */
export function invalidateWork(qc: QueryClient) {
  for (const k of ['issues', 'issue', 'my-issues', 'reports', 'activity', 'project']) qc.invalidateQueries({ queryKey: [k] });
}

type IssuePatch = Partial<Pick<Issue, 'title' | 'description' | 'type' | 'statusId' | 'priority' | 'assigneeId' | 'sprintId' | 'epicId' | 'parentId' | 'storyPoints' | 'startDate' | 'dueDate' | 'labels'>>;

/** Optimistically patches the issue in its project list so boards feel instant. */
export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, patch }: { issue: Issue; patch: IssuePatch }) => api.patch<Issue>(`/issues/${issue.key}`, patch),
    onMutate: async ({ issue, patch }) => {
      const key = keys.issues(issue.projectId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Issue[]>(key);
      const statuses = qc.getQueryData<ProjectDetail>(keys.project(issue.projectId))?.statuses;
      qc.setQueryData<Issue[]>(key, (list) => list?.map((i) => (i.id === issue.id ? withStatus({ ...i, ...patch }, statuses) : i)));
      return { previous, key };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toastError(err);
    },
    onSettled: () => invalidateWork(qc),
  });
}

interface MoveArgs { issue: Issue; statusId?: number; sprintId?: number | null; beforeId?: number | null; afterId?: number | null; rank: number }

export function useMoveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, statusId, sprintId, beforeId, afterId }: MoveArgs) => api.post<Issue>(`/issues/${issue.key}/move`, { statusId, sprintId, beforeId, afterId }),
    onMutate: async ({ issue, statusId = issue.statusId, sprintId = issue.sprintId, rank }) => {
      const key = keys.issues(issue.projectId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Issue[]>(key);
      const statuses = qc.getQueryData<ProjectDetail>(keys.project(issue.projectId))?.statuses;
      qc.setQueryData<Issue[]>(key, (list) => list?.map((i) => (i.id === issue.id ? withStatus({ ...i, statusId, sprintId, rank }, statuses) : i)));
      return { previous, key };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      toastError(err);
    },
    onSettled: () => invalidateWork(qc),
  });
}

function withStatus(issue: Issue, statuses?: Status[]): Issue {
  const s = statuses?.find((x) => x.id === issue.statusId);
  return s ? { ...issue, statusName: s.name, statusCategory: s.category } : issue;
}

export function useTodoMutations(day: string) {
  const qc = useQueryClient();
  const key = keys.todos(day);
  const patchLocal = (id: number, patch: Partial<Todo>) =>
    qc.setQueryData<TodoDay>(key, (d) => d && { ...d, items: d.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['todos'] });
  return {
    add: useMutation({ mutationFn: (body: { text: string; timeBlock?: string; important?: boolean; issueRef?: string }) => api.post<Todo>('/todos', { day, ...body }), onSettled: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: number; patch: Partial<Todo> }) => api.patch<Todo>(`/todos/${id}`, patch),
      onMutate: ({ id, patch }) => patchLocal(id, patch),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.del(`/todos/${id}`),
      onMutate: (id) => qc.setQueryData<TodoDay>(key, (d) => d && { ...d, items: d.items.filter((t) => t.id !== id) }),
      onSettled: refresh,
    }),
    clear: useMutation({ mutationFn: () => api.post('/todos/clear-completed', { day }), onSettled: refresh }),
  };
}
