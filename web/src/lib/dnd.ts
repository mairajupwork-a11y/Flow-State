import type { Announcements } from '@dnd-kit/core';

/**
 * Screen-reader messages for drag and drop that use the app's own words
 * ("Picked up WEB-12…") instead of dnd-kit's "Draggable item 5…".
 * `item` names a dragged id; `place` names a drop target (a column, a sprint, or another item).
 */
export function announcements(item: (id: string | number) => string, place: (id: string | number) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${item(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${item(active.id)} is over ${place(over.id)}.` : `${item(active.id)} is no longer over a drop area.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${item(active.id)} in ${place(over.id)}.` : `${item(active.id)} was dropped back where it started.`),
    onDragCancel: ({ active }) => `Moving ${item(active.id)} was cancelled.`,
  };
}
