import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Logo, Mark } from '../../components/Logo';
import { useSession } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { prefersReducedMotion, useReveal } from '../../lib/motion';
import explorer from '../../assets/mars-explorer.webp';
import hills from '../../assets/mars-explorer-hills.webp';
import desert from '../../assets/mars-desert.webp';
import boulder from '../../assets/rocks/boulder.webp';
import slab from '../../assets/rocks/slab.webp';
import shotBoard from '../../assets/shots/board.webp';
import shotOverview from '../../assets/shots/overview.webp';
import shotIssue from '../../assets/shots/issue.webp';
import shotDay from '../../assets/shots/myday.webp';
import shotReports from '../../assets/shots/reports.webp';
import shotAutomations from '../../assets/shots/automations.webp';
import shotGuide from '../../assets/shots/guide.webp';

export function Brand({ to = '/', onDark = false, height = 28 }: { to?: string; onDark?: boolean; height?: number }) {
  return (
    <Link to={to} className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="WorkMars home">
      <Logo onDark={onDark} height={height} />
    </Link>
  );
}

/**
 * One scroll engine for the whole page. Every element marked `data-track`
 * gets a progress value that eases towards the real scroll position each
 * frame (so wheel steps glide instead of jumping):
 *   data-track="stage" → --p: 0 → 1 while a tall section's sticky stage is pinned
 *   data-track="view"  → --v: 0 → 1 from entering the bottom to leaving the top
 * `onFrame` runs after each update, with the eased values, for anything that
 * reads them (the floating chrome).
 */
function useScrollEngine(root: RefObject<HTMLElement | null>, onFrame: (get: (el: Element | null) => number) => void) {
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const items = [...host.querySelectorAll<HTMLElement>('[data-track]')].map((el) => ({ el, stage: el.dataset.track === 'stage', cur: -1 }));
    const value = new Map<Element, number>();
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = performance.now();
    const target = (it: (typeof items)[number]) => {
      const r = it.el.getBoundingClientRect();
      const vh = innerHeight;
      const t = it.stage ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
      return Math.min(1, Math.max(0, t));
    };
    const measure = () => {
      // The story strip travels exactly as far as its content is wider than its window.
      host.querySelectorAll<HTMLElement>('[data-travel]').forEach((track) => {
        const view = track.parentElement;
        if (view) track.style.setProperty('--travel', `${Math.max(0, track.scrollWidth - view.clientWidth)}px`);
      });
    };
    const tick = (now: number) => {
      raf = 0;
      // Frame-rate independent easing: about 16% of the remaining distance per 60fps frame.
      const k = reduced ? 1 : 1 - Math.pow(1 - 0.16, Math.min(4, (now - last) / 16.7));
      last = now;
      let moving = false;
      for (const it of items) {
        const t = target(it);
        const next = it.cur < 0 ? t : it.cur + (t - it.cur) * k;
        const done = Math.abs(t - next) < 0.0004;
        const v = done ? t : next;
        if (Math.abs(v - it.cur) > 0.00005) it.el.style.setProperty(it.stage ? '--p' : '--v', v.toFixed(4));
        it.cur = v;
        value.set(it.el, v);
        if (!done) moving = true;
      }
      frameRef.current((el) => (el ? value.get(el) ?? 0 : 0));
      if (moving) raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    const onResize = () => { measure(); wake(); };
    measure();
    tick(performance.now());
    addEventListener('scroll', wake, { passive: true });
    addEventListener('resize', onResize);
    // Images and fonts can change widths after the first measure.
    const late = setTimeout(onResize, 800);
    document.fonts?.ready.then(onResize).catch(() => {});
    return () => { removeEventListener('scroll', wake); removeEventListener('resize', onResize); cancelAnimationFrame(raf); clearTimeout(late); };
  }, [root]);
}

/** Uppercase sans with serif words swapped in: pass serif words wrapped in *asterisks*. */
function Mixed({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {text.split(/(\*[^*]+\*)/g).map((part, i) => (part.startsWith('*') ? <em key={i} className="pd-serif">{part.slice(1, -1)}</em> : part))}
    </span>
  );
}

const MANIFESTO = ['*Redefining* how', 'teams plan *and* ship.', 'Boards, sprints and', 'reports — *free* for', 'every person, *forever*.', 'Built to *win*.'];

const STORY: { img: string; cap: string; w: number; x: number; y: number; sp: number; tone?: 'full' }[] = [
  { img: desert, cap: 'Backlog, week 01', w: 300, x: 0, y: 8, sp: -90 },
  { img: shotBoard, cap: 'Board, week 02', w: 640, x: 360, y: 26, sp: 40, tone: 'full' },
  { img: hills, cap: 'Review, week 03', w: 280, x: 1060, y: 4, sp: -130 },
  { img: shotReports, cap: 'Reports, week 04', w: 420, x: 1390, y: 40, sp: 70 },
  { img: explorer, cap: 'Shipped, week 05', w: 300, x: 1870, y: 10, sp: -60 },
];

const METHODS: { name: string; year: string; glyph: ReactNode }[] = [
  { name: 'Scrum', year: '1995', glyph: <GlyphScrum /> },
  { name: 'Kanban', year: '1953', glyph: <GlyphKanban /> },
  { name: 'Waterfall', year: '1970', glyph: <GlyphWaterfall /> },
  { name: 'Lean', year: '1988', glyph: <GlyphLean /> },
  { name: 'Six Sigma', year: '1986', glyph: <GlyphSigma /> },
  { name: 'PRINCE2', year: '1996', glyph: <GlyphPrince /> },
  { name: 'Scrumban', year: '2009', glyph: <GlyphScrumban /> },
  { name: 'Your own', year: 'Today', glyph: <GlyphSimple /> },
];

const DECK: { img: string; label: string; serif: string }[] = [
  { img: shotDay, label: 'My', serif: 'day' },
  { img: shotReports, label: 'Live', serif: 'reports' },
  { img: shotGuide, label: 'Mars', serif: 'guide' },
  { img: shotBoard, label: 'Team', serif: 'board' },
  { img: shotAutomations, label: 'Auto', serif: 'mations' },
  { img: shotIssue, label: 'Every', serif: 'detail' },
  { img: shotOverview, label: 'Big', serif: 'picture' },
];

const TOOLS = ['Google Calendar', 'Gmail', 'Outlook', 'Apple Calendar', 'Supabase', 'PostgreSQL', 'Google sign-in', 'Ollama', 'Any SMTP', 'Web push'];

export function Welcome() {
  const { data } = useSession();
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
      const [menu, setMenu] = useState(false);
  const [ground, setGround] = useState<'light' | 'dark'>('light');
  const [, setTheme, dark] = useTheme();
  useReveal(root);
  // The floating chrome reads the ground beneath it and flips its colours to match.
  // The hero turns from cream to olive as it shrinks, so it reports its own ground.
  useScrollEngine(root, (get) => {
    const el = document.elementsFromPoint(innerWidth / 2, 46).map((n) => n.closest<HTMLElement>('[data-ground]')).find(Boolean);
    const inHero = !!el && !!hero.current?.contains(el);
    const next = inHero ? (get(hero.current) > 0.3 ? 'dark' : 'light') : ((el?.dataset.ground as 'light' | 'dark') ?? 'light');
    setGround((g) => (g === next ? g : next));
  });

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [menu]);

  if (data?.user) return <Navigate to="/" replace />;
  const go = (id: string) => { setMenu(false); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })); };

  return (
    <div className="pd" ref={root}>
      {/* ---------- Floating chrome ---------- */}
      <header className={`pd-chrome on-${menu ? 'dark' : ground}`}>
        <Brand to="/welcome" onDark={menu || ground === 'dark'} height={34} />
        <button className="pd-mono" onClick={() => go('top')} aria-label="Back to top"><Mark size={40} /></button>
        <div className="pd-chrome-right">
          <Link to="/login" className="pd-login">Log in</Link>
          <Link to="/signup" className="pd-btn"><Icon name="bolt" size={16} /> Start free</Link>
          <button className={`pd-menu-btn ${menu ? 'open' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="pd-menu" aria-label={menu ? 'Close menu' : 'Open menu'}><i /><i /></button>
        </div>
      </header>

      <nav id="pd-menu" className={`pd-menu ${menu ? 'open' : ''}`} aria-hidden={!menu}>
        <div className="pd-menu-in">
          <ul>
            {[['features', 'Features'], ['methods', 'Methods'], ['pricing', 'Pricing'], ['tools', 'Works with'], ['deck', 'Inside WorkMars']].map(([id, label], i) => (
              <li key={id} style={{ '--i': i } as CSSProperties}><button tabIndex={menu ? 0 : -1} onClick={() => go(id)}><span>0{i + 1}</span>{label}</button></li>
            ))}
          </ul>
          <div className="pd-menu-side">
            <p className="pd-quote">the workflow tool for teams who would <b>rather ship</b> than <b>pay per seat.</b></p>
            <div className="row-8">
              <Link to="/signup" className="pd-btn" tabIndex={menu ? 0 : -1}>Create a free account <Hook size={16} /></Link>
              <Link to="/login" className="pd-btn ghost" tabIndex={menu ? 0 : -1}>Log in</Link>
            </div>
            <button className="pd-theme" tabIndex={menu ? 0 : -1} onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={15} /> {dark ? 'Light' : 'Dark'} app theme</button>
          </div>
        </div>
      </nav>

      <main id="top">
        {/* ---------- Hero: the explorer assembles, then shrinks into an inset card ---------- */}
        <section className="pd-hero" ref={hero} data-ground="light" data-track="stage">
          <div className="pd-hero-stage" data-ground="light">
            <div className="pd-marquee" aria-hidden="true">
              <div className="pd-marquee-track">
                {[0, 1].map((k) => <span key={k}><Mixed text="Work *beautifully* — together — at *zero* cost — " /></span>)}
              </div>
            </div>
            <div className="pd-portrait">
              <div className="pd-bands" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ '--i': i, backgroundImage: `url(${hills})` } as CSSProperties} />)}
              </div>
              <img src={hills} alt="An explorer in a spacesuit between two red hills" className="pd-portrait-img" />
              <span className="pd-scribble" aria-hidden="true"><Scribble /></span>
            </div>
            <h1 className="sr-only">WorkMars: workflow management for unlimited people, at zero cost</h1>
            <div className="pd-hero-overlay">
              <Ticket />
              <div className="pd-scroll-hint" aria-hidden="true"><span>Scroll</span><i /></div>
            </div>
          </div>
        </section>

        {/* ---------- Manifesto ---------- */}
        <section className="pd-manifesto" data-ground="dark" id="features" data-track="stage">
          <div className="pd-manifesto-stage">
            <p className="pd-statement" aria-label={MANIFESTO.join(' ').replace(/\*/g, '')}>
              {(() => {
                let n = 0;
                const total = MANIFESTO.join(' ').split(' ').length;
                return MANIFESTO.map((line, li) => (
                  <span className="pd-line" key={li} aria-hidden="true">
                    {line.split(' ').map((word, wi) => {
                      const serif = word.startsWith('*') || word.endsWith('*') || /^\*.*\*[.,—]*$/.test(word);
                      const clean = word.replace(/\*/g, '');
                      const style = { '--i': n++, '--n': total } as CSSProperties;
                      return <span key={wi} className={`pd-word ${serif ? 'pd-serif' : ''}`} style={style}>{clean} </span>;
                    })}
                  </span>
                ));
              })()}
            </p>
            <div className="pd-callout">
              <p className="pd-quote light">“we built workmars so <b>every team</b> gets the tools the big teams have, <b>without the invoice.</b>”</p>
              <span className="pd-sign"><Scribble /></span>
            </div>
          </div>
        </section>

        {/* ---------- Scattered story, pinned and scrolled sideways ---------- */}
        <section className="pd-story" data-ground="light" data-track="stage">
          <div className="pd-story-stage">
            <div className="pd-story-head" data-reveal>
              <p className="pd-eyebrow">The season</p>
              <h2 className="pd-title"><Mixed text="From *idea*" /><br /><Mixed text="to *done*." /></h2>
              <p className="pd-body">Capture it in the backlog, pull it across the board, review it, ship it. Every step lives in one calm place your whole team can see.</p>
            </div>
            <div className="pd-story-viewport"><div className="pd-story-track" data-travel style={{ width: Math.max(...STORY.map((f) => f.x + f.w)) + 140 }}>
              {STORY.map((f) => (
                <figure key={f.cap} className={`pd-frag ${f.tone === 'full' ? 'full' : ''}`} style={{ width: f.w, left: f.x, top: `${f.y}%`, '--sp': f.sp } as CSSProperties}>
                  <figcaption>{f.cap}</figcaption>
                  <img src={f.img} alt="" loading="lazy" />
                </figure>
              ))}
            </div></div>
          </div>
        </section>

        {/* ---------- Team board / My day ---------- */}
        <section className="pd-teaser" data-ground="light" data-track="view">
          <img className="pd-cut left" src={boulder} alt="" aria-hidden="true" />
          <img className="pd-cut right" src={slab} alt="" aria-hidden="true" />
          <div className="pd-teaser-cols">
            <div className="pd-teaser-col" data-reveal>
              <h2 className="pd-split"><em className="pd-serif">Team</em><span>Board</span></h2>
              <p className="pd-body">Boards, sprints, timelines and reports for the whole team, with as many people as you like. Drag work across, set limits, and see it all move live.</p>
              <Link to="/signup" className="pd-tile" aria-label="Start a team board"><Hook size={22} /></Link>
            </div>
            <div className="pd-teaser-col" data-reveal style={{ '--d': '120ms' } as CSSProperties}>
              <h2 className="pd-split"><em className="pd-serif">My</em><span>Day</span></h2>
              <p className="pd-body">A private to-do list next to team work. Morning, afternoon, evening, with gentle roll-over and a free AI guide that plans it for you.</p>
              <Link to="/signup" className="pd-tile" aria-label="Plan my day"><Hook size={22} /></Link>
            </div>
          </div>
        </section>

        {/* ---------- Full-bleed portrait with a quote ---------- */}
        <section className="pd-bleed" data-ground="dark" data-track="view">
          <img src={explorer} alt="An explorer kneeling on a rocky Mars-like plain" loading="lazy" />
          <div className="pd-bleed-copy" data-reveal>
            <p className="pd-eyebrow light">Mars guide · free AI</p>
            <h2 className="pd-title light"><Mixed text="Your *co-pilot*" /><br /><Mixed text="for the *day*." /></h2>
            <p className="pd-body light">Ask it to plan your day and it reads your real board. Describe a task in plain English and it becomes a work item. No paid AI, no limits.</p>
          </div>
        </section>

        {/* ---------- Method hall of fame ---------- */}
        <section className="pd-hall" id="methods" data-ground="dark" data-track="view">
          <div className="pd-hall-head" data-reveal>
            <p className="pd-eyebrow light">Every way of working</p>
            <h2 className="pd-title light"><Mixed text="Method" /> <Mixed text="*hall of fame*" /></h2>
          </div>
          <div className="pd-hall-grid">
            {METHODS.map((m, i) => (
              <article key={m.name} className="pd-hcard" data-reveal style={{ '--d': `${(i % 4) * 80 + Math.floor(i / 4) * 60}ms` } as CSSProperties}>
                <div className="pd-hcard-art">{m.glyph}</div>
                <div className="pd-hcard-tab"><b>{m.name}</b><span>{m.year}</span></div>
              </article>
            ))}
          </div>
          <div className="pd-hall-cta" data-reveal>
            <p>Each one sets up the right board, views and reports. Switch any time without losing work.</p>
            <Link to="/signup" className="pd-btn">Pick your method <Hook size={16} /></Link>
          </div>
        </section>

        {/* ---------- Pricing (the "store") ---------- */}
        <section className="pd-store" id="pricing" data-ground="light" data-track="view">
          <div className="pd-store-copy" data-reveal>
            <p className="pd-eyebrow"><Icon name="diamond" size={14} /> WorkMars plan</p>
            <h2 className="pd-title big"><Mixed text="Every feature" /><br /><Mixed text="*free.*" /></h2>
            <p className="pd-body">Unlimited people, projects, boards, automations, attachments, custom fields and the AI guide. No seat prices, no hidden tiers, no trial that runs out.</p>
            <div className="pd-price"><b>$0</b><span>per person<br />per month, forever</span></div>
            <Link to="/signup" className="pd-btn">Start free <Hook size={16} /></Link>
          </div>
          <div className="pd-collage" aria-hidden="true">
            <img className="c1" src={shotOverview} alt="" loading="lazy" data-reveal />
            <img className="c2" src={shotIssue} alt="" loading="lazy" data-reveal />
            <img className="c3" src={shotDay} alt="" loading="lazy" data-reveal />
          </div>
        </section>

        {/* ---------- Works with ---------- */}
        <section className="pd-tools" id="tools" data-ground="light" data-track="view">
          <div className="pd-tools-head" data-reveal>
            <span className="pd-brush" aria-hidden="true"><span>Connected</span></span>
            <h2 className="pd-title"><Mixed text="Works with *your* tools" /></h2>
          </div>
          <div className="pd-logos" aria-label="Works with">
            <div className="pd-logos-track">
              {[...TOOLS, ...TOOLS].map((t, i) => <span key={i} aria-hidden={i >= TOOLS.length}>{t}</span>)}
            </div>
          </div>
        </section>

        {/* ---------- Fanned deck ---------- */}
        <section className="pd-deck" id="deck" data-ground="light" data-track="view">
          <h2 className="pd-title center" data-reveal><Mixed text="What's up" /> <Mixed text="*inside*" /></h2>
          <div className="pd-fan">
            {DECK.map((c, i) => (
              <figure key={c.serif} className={`pd-fan-card ${i === (DECK.length - 1) / 2 ? 'center' : ''}`} style={{ '--k': i - (DECK.length - 1) / 2, '--ak': Math.abs(i - (DECK.length - 1) / 2) } as CSSProperties}>
                <img src={c.img} alt="" loading="lazy" />
                <figcaption><span>{c.label}</span><em className="pd-serif">{c.serif}</em></figcaption>
              </figure>
            ))}
          </div>
        </section>
      </main>

      {/* ---------- Inset footer on the lime halo ---------- */}
      <footer className="pd-footer" data-ground="light" data-track="view">
        <div className="pd-footer-panel" data-ground="dark">
          <h2 className="pd-title light center" data-reveal><Mixed text="Always shipping" /><br /><Mixed text="the *work.*" /></h2>
          <div className="pd-footer-grid">
            <div>
              <p className="pd-eyebrow light">Product</p>
              <button onClick={() => go('features')}>Features</button><button onClick={() => go('methods')}>Methods</button><button onClick={() => go('pricing')}>Pricing</button>
            </div>
            <div className="pd-footer-mid">
              <Mark size={64} />
              <Link to="/signup" className="pd-btn">Create free account</Link>
            </div>
            <div>
              <p className="pd-eyebrow light">Account</p>
              <Link to="/signup">Sign up</Link><Link to="/login">Log in</Link><Link to="/forgot-password">Reset password</Link>
            </div>
          </div>
          <div className="pd-footer-base">
            <Brand to="/welcome" onDark height={30} />
            <span>Free for unlimited users · No ads · Your data stays yours</span>
            <span>© {new Date().getFullYear()} WorkMars</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The hooked return arrow used on lime buttons and tiles. */
function Hook({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pd-hook">
      <path d="M5 4v7a4 4 0 0 0 4 4h11" /><path d="m15 10 5 5-5 5" />
    </svg>
  );
}

/** "Next race" ticket, WorkMars edition. */
function Ticket() {
  return (
    <aside className="pd-ticket" aria-label="Now live">
      <span className="pd-ticket-tab">Now live</span>
      <svg viewBox="0 0 120 54" className="pd-ticket-map" aria-hidden="true">
        <path d="M6 44 L6 14 Q6 6 14 6 L40 6 Q48 6 48 14 L48 24 Q48 30 54 30 L84 30 Q92 30 92 22 L92 14 Q92 6 100 6 L106 6 Q114 6 114 14 L114 40 Q114 48 106 48 L14 48 Q6 48 6 44 Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx="48" cy="24" r="3.5" fill="#d2ff00" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <b>WorkMars 1.0</b>
      <hr />
      <div className="pd-ticket-foot"><span className="pd-laurel"><Icon name="star" size={13} /></span><small>Free for unlimited users<br />since 2026</small></div>
    </aside>
  );
}

/** The hand-drawn signature: a lime scribble. */
function Scribble() {
  return (
    <svg viewBox="0 0 320 110" fill="none" aria-hidden="true">
      <path className="pd-ink" d="M14 72 C 30 20, 46 18, 40 70 C 36 98, 64 30, 74 36 C 84 42, 70 86, 90 66 C 104 50, 112 30, 120 44 C 128 58, 116 84, 136 72 C 154 60, 150 40, 168 46 C 184 52, 168 78, 190 70 C 214 60, 216 30, 236 40 C 252 48, 240 74, 262 66 C 280 58, 296 46, 306 50 M 60 92 C 120 84, 220 82, 300 88"
        stroke="#d2ff00" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Method glyphs: line drawings on Visor Black, lime accents ---------- */
const G = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 200 160" fill="none" stroke="#dde1d2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
function GlyphScrum() {
  return <G><circle cx="100" cy="80" r="46" strokeDasharray="6 7" /><path d="M146 80a46 46 0 0 1-30 43" stroke="#d2ff00" strokeWidth="4" /><path d="M110 118l8 6-2-10" stroke="#d2ff00" strokeWidth="4" /><rect x="84" y="64" width="32" height="32" rx="2" /><path d="M92 80h16M100 72v16" /></G>;
}
function GlyphKanban() {
  return <G>{[34, 84, 134].map((x, i) => <g key={x}><path d={`M${x} 26h32`} /><rect x={x} y="36" width="32" height="20" rx="2" stroke={i === 1 ? '#d2ff00' : '#dde1d2'} strokeWidth={i === 1 ? 3.5 : 2.4} />{i !== 1 && <rect x={x} y="62" width="32" height="20" rx="2" />}{i === 0 && <rect x={x} y="88" width="32" height="20" rx="2" />}</g>)}</G>;
}
function GlyphWaterfall() {
  return <G>{[0, 1, 2, 3].map((i) => <rect key={i} x={30 + i * 34} y={28 + i * 24} width="54" height="16" rx="2" stroke={i === 3 ? '#d2ff00' : '#dde1d2'} strokeWidth={i === 3 ? 3.5 : 2.4} />)}{[0, 1, 2].map((i) => <path key={i} d={`M${78 + i * 34} 44v8h6`} />)}</G>;
}
function GlyphLean() {
  return <G><path d="M24 80h34M78 80h34M132 80h40" /><path d="M58 70l12 10-12 10M112 70l12 10-12 10M166 70l12 10-12 10" stroke="#d2ff00" strokeWidth="3.5" /><circle cx="40" cy="52" r="8" /><circle cx="95" cy="52" r="8" /><circle cx="150" cy="52" r="8" /></G>;
}
function GlyphSigma() {
  return <G><path d="M20 126h160" /><path d="M24 124C60 124 70 34 100 34s40 90 76 90" stroke="#d2ff00" strokeWidth="3.5" /><path d="M64 126V96M136 126V96" strokeDasharray="4 6" /><path d="M100 34v92" strokeDasharray="4 6" /></G>;
}
function GlyphPrince() {
  return <G>{[0, 1, 2, 3].map((i) => <g key={i}><rect x={22 + i * 42} y="60" width="30" height="40" rx="2" stroke={i === 2 ? '#d2ff00' : '#dde1d2'} strokeWidth={i === 2 ? 3.5 : 2.4} />{i < 3 && <path d={`M${56 + i * 42} 80h4`} />}</g>)}<path d="M22 44h156" strokeDasharray="3 6" /><path d="M100 30v14" /></G>;
}
function GlyphScrumban() {
  return <G><circle cx="62" cy="80" r="34" strokeDasharray="6 7" /><path d="M96 80a34 34 0 0 1-20 31" stroke="#d2ff00" strokeWidth="4" />{[118, 152].map((x) => <g key={x}><path d={`M${x} 40h26`} /><rect x={x} y="50" width="26" height="16" rx="2" /><rect x={x} y="72" width="26" height="16" rx="2" /></g>)}</G>;
}
function GlyphSimple() {
  return <G>{[0, 1, 2].map((i) => <g key={i}><rect x="46" y={38 + i * 30} width="18" height="18" rx="2" stroke={i < 2 ? '#d2ff00' : '#dde1d2'} />{i < 2 && <path d={`M50 ${47 + i * 30}l4 4 7-8`} stroke="#d2ff00" strokeWidth="3" />}<path d={`M76 ${47 + i * 30}h${78 - i * 18}`} /></g>)}</G>;
}
