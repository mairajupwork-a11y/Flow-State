import { useSyncExternalStore } from 'react';
import type { IssueType } from './types';

/** Minimal external store — app-wide UI state without a dependency. */
function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export interface CreateDraft { statusId?: number; sprintId?: number | null; phaseId?: number | null; dueDate?: string; type?: IssueType; parentId?: number; epicId?: number; title?: string; projectId?: number }

interface UiState {
  guideOpen: boolean;
  guidePrompt: string | null;
  create: CreateDraft | null;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  sidebarOpen: boolean;
  createProjectOpen: boolean;
  inviteOpen: boolean;
}

export const ui = createStore<UiState>({
  guideOpen: false, guidePrompt: null, create: null, paletteOpen: false, shortcutsOpen: false,
  sidebarOpen: false, createProjectOpen: false, inviteOpen: false,
});

export function useUi<K>(select: (s: UiState) => K): K {
  return useSyncExternalStore(ui.subscribe, () => select(ui.get()));
}

export const openGuide = (prompt: string | null = null) => ui.set({ guideOpen: true, guidePrompt: prompt });
export const openCreate = (draft: CreateDraft = {}) => ui.set({ create: draft });

// ---- Toasts ----
export interface Toast { id: number; message: string; tone: 'default' | 'error'; action?: { label: string; run: () => void } }
const toasts = createStore<{ list: Toast[] }>({ list: [] });
let toastId = 0;
export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action'] } = {}) {
  const id = ++toastId;
  toasts.set((s) => ({ list: [...s.list.slice(-2), { id, message, tone: opts.tone ?? 'default', action: opts.action }] }));
  setTimeout(() => toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) })), opts.action ? 6000 : 3200);
}
export const toastError = (err: unknown) => toast(err instanceof Error ? err.message : 'Something went wrong.', { tone: 'error' });
export const dismissToast = (id: number) => toasts.set((s) => ({ list: s.list.filter((t) => t.id !== id) }));
export const useToasts = () => useSyncExternalStore(toasts.subscribe, () => toasts.get().list);

// ---- In-app confirmations (native confirm/prompt are blocked in embedded frames and look out of place) ----
export interface ConfirmRequest { title: string; body?: string; confirmLabel?: string; danger?: boolean; typeToConfirm?: string; resolve: (ok: boolean) => void }
const confirms = createStore<{ current: ConfirmRequest | null }>({ current: null });
export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => confirms.set({ current: { ...opts, resolve } }));
}
export function settleConfirm(ok: boolean) {
  confirms.get().current?.resolve(ok);
  confirms.set({ current: null });
}
export const useConfirm = () => useSyncExternalStore(confirms.subscribe, () => confirms.get().current);

/** Copies text, falling back to a helpful message when the clipboard is unavailable. */
export function copyText(text: string, message = 'Copied.') {
  const fail = () => toast('Copy isn’t available here — select the text and copy it manually.', { tone: 'error' });
  try {
    navigator.clipboard ? navigator.clipboard.writeText(text).then(() => toast(message), fail) : fail();
  } catch {
    fail();
  }
}
