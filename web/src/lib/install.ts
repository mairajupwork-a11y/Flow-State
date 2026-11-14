import { useSyncExternalStore } from 'react';
import { isIos, isStandalone } from './push';

/** "Install WorkMars" support. Chrome, Edge and Android fire `beforeinstallprompt`; we keep it so a button can
 *  open the install dialog later. Safari (iPhone/iPad/Mac) has no such event, so we show Add to Home Screen steps. */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: PromptEvent | null = null;
let installed = typeof window !== 'undefined' && isStandalone();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => { installed = e.matches; emit(); });
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual';
const snapshot = (): InstallState => (installed ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : 'manual');

export function useInstall() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, snapshot, () => 'manual' as InstallState);
}

/** Opens the browser's install dialog. Returns true if the person installed. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; emit();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
