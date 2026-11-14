import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { toastError } from './store';

export interface TimeEntry {
  id: number; issueId: number; projectId: number; userId: number; userName: string; userColor: string; issueKey: string; issueTitle: string;
  projectName: string; client: string; startedAt: string; endedAt: string | null; running: boolean; minutes: number; note: string; billable: boolean;
}

/** 95 → "1h 35m", 30 → "30m", 120 → "2h". */
export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}
/** 4521 seconds → "1:15:21". */
export function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** Reads "1h 30m", "1h30", "90m", "90", "1.5h", "1.5", "1:30" as minutes. Returns null if it can't. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m?)?$/)) && (m[1] || m[2])) {
    const hours = m[1] ? Number(m[1]) : 0;
    const mins = m[2] ? Number(m[2]) : 0;
    // A bare number under 10 reads as hours ("2" = 2 hours); larger bare numbers as minutes ("45").
    if (!m[1] && !s.endsWith('m') && mins <= 9) return mins * 60;
    return Math.round(hours * 60 + mins);
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(Number(m[1]) * 60);
  return null;
}

/** Seconds since an ISO time, ticking once a second while mounted. */
export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, (now - new Date(since).getTime()) / 1000) : 0;
}

export const useRunningTimer = () => useQuery({ queryKey: ['time', 'running'], queryFn: () => api.get<TimeEntry | null>('/time/running'), refetchInterval: 60_000 });
export const useIssueTime = (ref: string) => useQuery({ queryKey: ['time', 'issue', ref], queryFn: () => api.get<{ entries: TimeEntry[]; totalMinutes: number; myMinutes: number }>(`/issues/${ref}/time`) });

export function useTimeActions() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['time'] }); qc.invalidateQueries({ queryKey: ['issues'] }); qc.invalidateQueries({ queryKey: ['issue'] }); };
  return {
    start: useMutation({ mutationFn: (ref: string) => api.post<TimeEntry>(`/issues/${ref}/time/start`, {}), onSuccess: refresh, onError: toastError }),
    stop: useMutation({ mutationFn: () => api.post<TimeEntry | null>('/time/stop', {}), onSuccess: refresh, onError: toastError }),
    log: useMutation({ mutationFn: ({ ref, body }: { ref: string; body: { minutes: number; startedAt?: string; note?: string; billable?: boolean } }) => api.post<TimeEntry>(`/issues/${ref}/time`, body), onSuccess: refresh, onError: toastError }),
    update: useMutation({ mutationFn: ({ id, body }: { id: number; body: Partial<{ minutes: number; note: string; billable: boolean; startedAt: string }> }) => api.patch<TimeEntry>(`/time/${id}`, body), onSuccess: refresh, onError: toastError }),
    remove: useMutation({ mutationFn: (id: number) => api.del(`/time/${id}`), onSuccess: refresh, onError: toastError }),
  };
}
