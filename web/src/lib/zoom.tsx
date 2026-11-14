import { useRef, type ComponentProps } from 'react';
import { DragOverlay, useDndContext, type ClientRect, type Modifier } from '@dnd-kit/core';
import type { Transform } from '@dnd-kit/utilities';

/**
 * The page-wide UI scale set in CSS (`--ui-zoom`, 0.75 on desktops). Pointer positions and
 * getBoundingClientRect are in screen pixels, but sizes and offsets we set inside the page are
 * multiplied by the zoom, so code that turns one into the other divides by this.
 */
export function uiZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** A dnd-kit transform measured in screen pixels, converted for an element inside the zoomed page. */
export function unzoom(t: Transform | null): Transform | null {
  const z = uiZoom();
  return !t || z === 1 ? t : { ...t, x: t.x / z, y: t.y / z };
}

const unzoomModifier: Modifier = ({ transform }) => unzoom(transform)!;

/**
 * dnd-kit measures items "without their transform" by subtracting the CSS translate from the
 * on-screen box. Under zoom the translate is in page pixels, so scale it back to screen pixels.
 */
function measure(el: HTMLElement): ClientRect {
  const r = el.getBoundingClientRect();
  const z = uiZoom();
  const tr = getComputedStyle(el).transform;
  const m = tr && tr !== 'none' ? new DOMMatrixReadOnly(tr) : null;
  const left = r.left - (m ? m.e * z : 0), top = r.top - (m ? m.f * z : 0);
  return { top, left, width: r.width, height: r.height, right: left + r.width, bottom: top + r.height };
}

/** Pass to `<DndContext measuring={…}>` so cards and columns are measured correctly under zoom. */
export const zoomSafeMeasuring = { draggable: { measure }, droppable: { measure } };

/**
 * A DragOverlay that stays under the pointer when the page is zoomed: dnd-kit places it in
 * screen pixels, so its starting box and its movement are converted to page pixels.
 */
export function ZoomSafeDragOverlay(props: ComponentProps<typeof DragOverlay>) {
  const { active, activeNodeRect } = useDndContext();
  const start = useRef<{ id: unknown; rect: ClientRect } | null>(null);
  if (!active) start.current = null;
  else if (activeNodeRect && start.current?.id !== active.id) start.current = { id: active.id, rect: activeNodeRect };
  const z = uiZoom();
  if (z === 1) return <DragOverlay {...props} />;
  const r = start.current?.rect;
  return (
    <DragOverlay
      {...props}
      dropAnimation={null}
      modifiers={[...(props.modifiers ?? []), unzoomModifier]}
      style={{ ...(r ? { top: r.top / z, left: r.left / z, width: r.width / z, height: r.height / z } : {}), ...props.style }}
    />
  );
}
