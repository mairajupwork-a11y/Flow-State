import { useEffect, useRef, type CSSProperties } from 'react';
import boulder from '../assets/rocks/boulder.webp';
import shard from '../assets/rocks/shard.webp';
import slab from '../assets/rocks/slab.webp';
import pebbleA from '../assets/rocks/pebble-a.webp';
import pebbleB from '../assets/rocks/pebble-b.webp';
import pebbleC from '../assets/rocks/pebble-c.webp';
import pebbleD from '../assets/rocks/pebble-d.webp';
import { prefersReducedMotion } from '../lib/motion';

const ART = { boulder, shard, slab, pebbleA, pebbleB, pebbleC, pebbleD };

/**
 * One rock: where it sits in its section (x/y as CSS lengths from the left
 * and top), its width at full size, how far it travels with scroll and the
 * pointer (depth: 0 = still, 1 = most), its resting tilt, how long one idle
 * float takes, where it sits on phones (omit to hide it there, so small
 * screens keep the copy clear), and whether it sits far back
 * (softly blurred, for depth of field).
 */
export interface Rock { art: keyof typeof ART; x: string; y: string; size: number; depth: number; rot: number; float: number; phone?: { x: string; y: string }; far?: boolean }

/**
 * Martian rocks drifting at different depths around a section: each one
 * floats gently on its own, moves with scroll and the pointer at its own
 * speed (closer rocks move more), and tips and lifts when hovered.
 * Decorative only: hidden from assistive tech, still with reduced motion.
 */
export function FloatingRocks({ rocks }: { rocks: Rock[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    let frame = 0;
    let mx = 0;
    let my = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      // -1 when the section is a screen below the viewport centre, +1 a screen above it.
      const p = Math.max(-1.5, Math.min(1.5, (innerHeight / 2 - (r.top + r.height / 2)) / innerHeight));
      el.style.setProperty('--p', p.toFixed(4));
      el.style.setProperty('--mx', mx.toFixed(4));
      el.style.setProperty('--my', my.toFixed(4));
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      mx = (e.clientX / innerWidth) * 2 - 1;
      my = (e.clientY / innerHeight) * 2 - 1;
      queue();
    };
    // Only work while the section is on screen.
    const io = new IntersectionObserver(([entry]) => {
      el.classList.toggle('is-live', entry.isIntersecting);
      if (entry.isIntersecting) queue();
    }, { rootMargin: '20% 0px' });
    io.observe(el);
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    addEventListener('pointermove', onPointer, { passive: true });
    update();
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener('scroll', queue);
      removeEventListener('resize', queue);
      removeEventListener('pointermove', onPointer);
    };
  }, []);

  return (
    <div ref={ref} className="rocks" aria-hidden="true">
      {rocks.map((r, i) => (
        <div key={i} className={`rock ${r.phone ? '' : 'rock-wide'} ${r.far ? 'rock-far' : ''}`}
          style={{ '--x': r.x, '--y': r.y, '--px': r.phone?.x, '--py': r.phone?.y, '--s': r.size, '--depth': r.depth, '--rot': `${r.rot}deg`, '--float': `${r.float}s`, '--delay': `${-i * 1.7}s` } as CSSProperties}>
          <div className="rock-float">
            <img src={ART[r.art]} alt="" draggable={false} loading="lazy" decoding="async" />
          </div>
        </div>
      ))}
    </div>
  );
}
