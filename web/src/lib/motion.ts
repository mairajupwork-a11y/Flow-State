import { useEffect, useRef, useState, type RefObject } from 'react';

/** True when the viewer (or Settings → Reduce motion) asks for less animation. */
export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
}

/**
 * Adds `.is-in` to every `[data-reveal]` element under `root` as it scrolls
 * into view. Content is visible by default; the hidden start state only
 * applies once `html.motion-ready` is set, so nothing is lost without JS.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      el.querySelectorAll('[data-reveal]').forEach((n) => n.classList.add('is-in'));
      return;
    }
    document.documentElement.classList.add('motion-ready');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    el.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [root]);
}

/**
 * Writes scroll-linked custom properties used by CSS:
 * --scroll (0→1 over the page) on <html>, and for each `[data-scroll]`
 * element --p (0→1 as it travels from the bottom of the viewport to the top,
 * or with data-scroll="exit", 0→1 over the first ~70% of a screen of scrolling).
 */
export function useScrollVars(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - innerHeight;
      doc.style.setProperty('--scroll', String(max > 0 ? Math.min(1, scrollY / max) : 0));
      if (prefersReducedMotion()) return;
      el.querySelectorAll<HTMLElement>('[data-scroll]').forEach((n) => {
        const r = n.getBoundingClientRect();
        // "exit": 0 at the top of the page, 1 once scrolled ~70% of a screen (hero hand-off).
        const p = n.dataset.scroll === 'exit'
          ? Math.min(1, Math.max(0, scrollY / (innerHeight * 0.7)))
          : Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height * 0.4)));
        n.style.setProperty('--p', p.toFixed(3));
      });
      // Sticky stacked cards: a card dims and recedes as the next one covers it.
      const cards = [...el.querySelectorAll<HTMLElement>('[data-stack]')];
      cards.forEach((card, i) => {
        const next = cards[i + 1];
        if (!next) return card.style.setProperty('--cover', '0');
        const top = card.getBoundingClientRect().top;
        const nextTop = next.getBoundingClientRect().top;
        const cover = Math.min(1, Math.max(0, 1 - (nextTop - top) / (innerHeight * 0.75)));
        card.style.setProperty('--cover', cover.toFixed(3));
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
      document.documentElement.style.removeProperty('--scroll');
    };
  }, [root]);
}

/** Types and deletes each phrase in turn, like a live cursor. */
export function useTypewriter(phrases: string[], { typeMs = 70, holdMs = 1600 } = {}) {
  const [text, setText] = useState(phrases[0] ?? '');
  const idx = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let i = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const phrase = phrases[idx.current % phrases.length];
      if (!deleting) {
        i++;
        setText(phrase.slice(0, i));
        if (i >= phrase.length) { deleting = true; timer = setTimeout(tick, holdMs); return; }
      } else {
        i--;
        setText(phrase.slice(0, i));
        if (i <= 0) { deleting = false; idx.current++; }
      }
      timer = setTimeout(tick, deleting ? typeMs / 2 : typeMs);
    };
    setText('');
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [phrases, typeMs, holdMs]);
  return text;
}
