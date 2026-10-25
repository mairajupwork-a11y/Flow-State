import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY = 'fs_sidebar_width';
const MIN = 210;
const MAX = 420;
const clamp = (w: number) => Math.round(Math.min(MAX, Math.max(MIN, w)));

/** Writes the width the sidebar CSS reads; null falls back to the stylesheet default. */
function apply(w: number | null) {
  if (w == null) document.documentElement.style.removeProperty('--sidebar-w');
  else document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
}

function saved() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v ? clamp(v) : null;
  } catch {
    return null;
  }
}

function persist(w: number | null) {
  try {
    if (w == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch { /* private mode: the width just won't be remembered */ }
}

const sidebarWidth = () => document.getElementById('sidebar')?.offsetWidth ?? 251;

/**
 * Drag handle on the sidebar's right edge (desktop only). Drag or use the arrow
 * keys to resize; double-click or Home restores the default width.
 */
export function SidebarResizer() {
  const [width, setWidth] = useState(() => {
    const w = saved();
    apply(w);
    return w ?? 251;
  });
  const [dragging, setDragging] = useState(false);

  // Track the real width (the default changes with the viewport) so the handle sits on the edge.
  useEffect(() => {
    const sync = () => setWidth(sidebarWidth());
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const set = useCallback((w: number | null) => {
    apply(w);
    persist(w);
    setWidth(w ?? sidebarWidth());
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.documentElement.classList.add('sidebar-resizing');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const w = clamp(e.clientX);
    apply(w);
    setWidth(w);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    document.documentElement.classList.remove('sidebar-resizing');
    persist(clamp(e.clientX));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 16;
    if (e.key === 'ArrowLeft') set(clamp(width - step));
    else if (e.key === 'ArrowRight') set(clamp(width + step));
    else if (e.key === 'Home') set(null);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`sidebar-resizer ${dragging ? 'dragging' : ''}`}
      style={{ left: width }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => set(null)}
      onKeyDown={onKeyDown}
    />
  );
}
