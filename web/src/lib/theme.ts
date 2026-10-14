import { useEffect, useState } from 'react';
import type { Theme } from './types';

const KEY = 'fs_theme';
const read = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
};

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

let current = read();
const listeners = new Set<(t: Theme) => void>();

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: theme lasts for this session */
  }
  apply(theme);
  listeners.forEach((l) => l(theme));
}

export function useTheme(): [Theme, (t: Theme) => void, boolean] {
  const [theme, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => current === 'system' && apply('system');
    mq.addEventListener('change', onChange);
    return () => {
      listeners.delete(set);
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return [theme, setTheme, document.documentElement.dataset.theme === 'dark'];
}

apply(current);

// Per-viewer display preferences (see Settings → Appearance).
try {
  document.documentElement.classList.toggle('compact', localStorage.getItem('fs_compact') === '1');
  document.documentElement.classList.toggle('reduce-motion', localStorage.getItem('fs_reduce_motion') === '1');
} catch {
  /* storage blocked */
}
