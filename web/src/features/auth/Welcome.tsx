import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { useSession } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { prefersReducedMotion, useReveal } from '../../lib/motion';
import { InstallButton } from '../../components/InstallApp';
import { Critter, Doodle, QuayScene, Spot, Village } from './harbor/Art';
import shotOverview from '../../assets/shots/overview.webp';
import shotBoard from '../../assets/shots/board.webp';
import shotDay from '../../assets/shots/myday.webp';
import shotReports from '../../assets/shots/reports.webp';

export function Brand({ to = '/', onDark = false, height = 28 }: { to?: string; onDark?: boolean; height?: number }) {
  return (
    <Link to={to} className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="WorkMars home">
      <Logo onDark={onDark} height={height} />
    </Link>
  );
}

/** Highlight the words wrapped in *asterisks* with a hand-drawn marker swash. */
function Marked({ text }: { text: string }) {
  return <>{text.split(/(\*[^*]+\*)/g).map((part, i) => (part.startsWith('*') ? <mark key={i} className="hb-mark">{part.slice(1, -1)}</mark> : part))}</>;
}

/** The offset editorial block: a small annotation on the left, the statement on the right. */
function Editorial({ note, index, title, children, id, as: Tag = 'h2' }: { note: string; index?: string; title: string; children?: ReactNode; id?: string; as?: 'h1' | 'h2' }) {
  return (
    <div className="hb-editorial" id={id}>
      <p className="hb-note" data-reveal>{index && <span className="hb-index">{index}</span>}{note}</p>
      <div className="hb-statement" data-reveal style={{ '--d': '80ms' } as CSSProperties}>
        <Tag className={Tag === 'h1' ? 'hb-display' : 'hb-h2'}><Marked text={title} /></Tag>
        {children}
      </div>
    </div>
  );
}

/** A real product capture in a lifted frame, with optional glass notes and a perched critter. */
function Shot({ src, alt, critter, notes, tint = 'mars' }: { src: string; alt: string; critter?: { kind: 'cat' | 'bird' | 'snail' | 'alien'; at: string }; notes?: ReactNode; tint?: 'mars' | 'sea' | 'mint' | 'lilac' | 'sun' }) {
  return (
    <div className={`hb-shot-wrap tint-${tint}`} data-reveal>
      <span className="hb-blob a" aria-hidden="true" /><span className="hb-blob b" aria-hidden="true" />
      <figure className="hb-shot">
        <img src={src} alt={alt} loading="lazy" />
      </figure>
      {critter && <Critter kind={critter.kind} className={`at-${critter.at}`} />}
      {notes}
    </div>
  );
}

const STEPS: { spot: 'rocket' | 'crew' | 'compass' | 'plug'; n: string; unit: string; title: string; body: string }[] = [
  { spot: 'rocket', n: '60', unit: 'seconds', title: 'Open a workspace', body: 'Name it, pick your field and your first project is ready — no card, no trial clock.' },
  { spot: 'crew', n: '∞', unit: 'seats', title: 'Bring the whole crew', body: 'Invite managers, developers, designers and clients. Everyone is free, always.' },
  { spot: 'compass', n: '8', unit: 'methods', title: 'Choose how you work', body: 'Scrum, Kanban, Scrumban, Waterfall, Lean, Six Sigma, PRINCE2 or your own.' },
  { spot: 'plug', n: '6+', unit: 'connections', title: 'Plug in your tools', body: 'Google Calendar, email, phone push, Google sign-in, Supabase and a local AI.' },
];

const INDEX: [string, string, string][] = [
  ['board', 'Boards & swimlanes', 'Drag cards, set WIP limits, group by person or priority.'],
  ['bolt', 'Sprints & velocity', 'Plan, start and close sprints; leftovers roll on.'],
  ['timeline', 'Timeline', 'A Gantt view of start and due dates.'],
  ['calendar', 'Calendar + Google', 'Due dates on a month grid and in your own calendar.'],
  ['people', 'Roles & project teams', 'Admins, managers, team members and viewers.'],
  ['check', 'Several assignees', 'Tick everyone who works on a card.'],
  ['sun', 'My day with reminders', 'A private list that pings your phone on time.'],
  ['sparkles', 'Free AI guide', 'Plans your day and turns sentences into tasks.'],
  ['zap', 'Automations', '“When it’s done, tell the reporter” — no code.'],
  ['sliders', 'Custom fields', 'Environment, budget, client — anything you track.'],
  ['attachment', 'Files & links', 'Drop screenshots, PDFs and links on any card.'],
  ['phone', 'Installable app', 'Phone, tablet or desktop, with offline start.'],
];

const METHODS: { name: string; blurb: string; color: string }[] = [
  { name: 'Scrum', blurb: 'Sprints & velocity', color: 'mars' },
  { name: 'Kanban', blurb: 'Flow & WIP limits', color: 'sea' },
  { name: 'Scrumban', blurb: 'The best of both', color: 'sun' },
  { name: 'Waterfall', blurb: 'Phases & gates', color: 'lilac' },
  { name: 'Lean', blurb: 'Waste out, value in', color: 'mint' },
  { name: 'Six Sigma', blurb: 'Measure & improve', color: 'mars' },
  { name: 'PRINCE2', blurb: 'Stages & controls', color: 'sea' },
  { name: 'Your own', blurb: 'Simple to-do lists', color: 'sun' },
];

const FAQ: [string, string][] = [
  ['Is WorkMars really free?', 'Yes. Every feature is free for every person — no seat prices, no premium tier and no trial that runs out. If you run it yourself, your only cost is your own server.'],
  ['How many people can join?', 'As many as you like. Invite your whole company, contractors and clients; viewers get read-only access and team members only see the projects they’re on.'],
  ['Who can change what?', 'The first account is the admin. Managers (project, product and program managers, team leads…) create cards, set dates and assign people. Team members comment, upload files, add links and move their cards.'],
  ['Where does my data live?', 'In your own database: a single SQLite file, or Postgres such as Supabase. Nothing is sold, shared or used for ads.'],
  ['Does it work on phones and tablets?', 'Yes. WorkMars is responsive and installable as an app (PWA) on iPhone, iPad, Android, Windows and Mac, with push notifications and reminders.'],
  ['Is the AI guide paid?', 'No. The Mars guide answers from your live workspace data for free. You can optionally connect your own local model (Ollama) for richer wording.'],
];

export function Welcome() {
  const { data } = useSession();
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [, setTheme, dark] = useTheme();
  useReveal(root);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 12);
    on();
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [menu]);

  if (data?.user) return <Navigate to="/" replace />;
  const go = (id: string) => { setMenu(false); document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); };
  const NAV: [string, string][] = [['features', 'Features'], ['methods', 'Methods'], ['pricing', 'Pricing'], ['faq', 'FAQ']];

  return (
    <div className="hb" ref={root}>
      <a href="#main" className="skip-link">Skip to content</a>
      {/* ---------- Glass navigation ---------- */}
      <header className={`hb-nav ${scrolled ? 'scrolled' : ''} ${menu ? 'open' : ''}`}>
        <div className="hb-nav-in">
          <Brand to="/welcome" height={30} />
          <nav className="hb-links" aria-label="Sections">
            {NAV.map(([id, label]) => <button key={id} onClick={() => go(id)}>{label}</button>)}
          </nav>
          <div className="hb-nav-right">
            <button className="hb-icon hb-theme" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}><Icon name={dark ? 'sun' : 'moon'} size={16} /></button>
            <Link to="/login" className="hb-btn quiet hide-sm">Log in</Link>
            <Link to="/signup" className="hb-btn dark">Start free <Icon name="arrow" size={14} /></Link>
            <button className="hb-icon hb-burger" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="hb-sheet" aria-label={menu ? 'Close menu' : 'Open menu'}><Icon name={menu ? 'close' : 'menu'} size={18} /></button>
          </div>
        </div>
        <div id="hb-sheet" className="hb-sheet" hidden={!menu}>
          {NAV.map(([id, label]) => <button key={id} onClick={() => go(id)}>{label}<Icon name="right" size={14} /></button>)}
          <Link to="/login" className="hb-btn quiet">Log in</Link>
          <InstallButton className="hb-btn quiet" />
          <button className="hb-btn quiet" onClick={() => setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={15} /> {dark ? 'Light' : 'Dark'} theme</button>
        </div>
      </header>

      <main id="main">
        {/* ---------- Hero ---------- */}
        <section className="hb-hero" id="top">
          <span className="hb-sky-blob one" aria-hidden="true" /><span className="hb-sky-blob two" aria-hidden="true" /><span className="hb-sky-blob three" aria-hidden="true" />
          <div className="hb-wrap">
            <Editorial as="h1" note="Free project management for every team, on any device." index="WorkMars" title="Plan, track and ship work together — *free* for every person, forever.">
              <p className="hb-lede" data-reveal style={{ '--d': '160ms' } as CSSProperties}>Boards, sprints, timelines, reports, reminders and a free AI guide in one calm workspace. No seat prices, no trial, no catch.</p>
              <div className="hb-actions" data-reveal style={{ '--d': '220ms' } as CSSProperties}>
                <Link to="/signup" className="hb-btn dark lg">Start free <Icon name="arrow" size={15} /></Link>
                <button className="hb-btn quiet lg" onClick={() => go('features')}>See how it works</button>
                <span className="hb-hand hb-hand-hero"><Doodle kind="curl" />no credit card, ever</span>
              </div>
              <ul className="hb-proof" data-reveal style={{ '--d': '280ms' } as CSSProperties}>
                <li><b>∞</b> people</li><li><b>8</b> ways of working</li><li><b>$0</b> per seat</li>
              </ul>
            </Editorial>
          </div>
          <div className="hb-stickers" aria-hidden="true">
            <div className="hb-glass hb-sticker s1"><span className="hb-dot mint" /> WEB-102 moved to <b>Done</b></div>
            <div className="hb-glass hb-sticker s2"><Icon name="bell" size={14} /> Reminder · <b>Stand-up in 10 min</b></div>
            <div className="hb-glass hb-sticker s3"><span className="hb-faces"><i style={{ background: '#e8643c' }}>PS</i><i style={{ background: '#5fa8d3' }}>DO</i><i style={{ background: '#79c39a' }}>MC</i></span> +12 joined today</div>
            <Doodle kind="star" className="hb-float-star a" /><Doodle kind="sparkle" className="hb-float-star b" />
          </div>
          <QuayScene />
        </section>

        {/* ---------- Main product shot ---------- */}
        <section className="hb-section hb-showcase">
          <div className="hb-wrap">
            <Shot src={shotOverview} alt="The WorkMars overview: project progress, your next tasks and the Mars guide" critter={{ kind: 'cat', at: 'top-right' }}
              notes={<>
                <div className="hb-glass hb-note-card n1"><span className="hb-chip sun">Sprint 4</span><b>14 of 18 done</b><span className="hb-bar"><i style={{ width: '78%' }} /></span></div>
                <div className="hb-glass hb-note-card n2"><Icon name="sparkles" size={15} /><span><b>Mars guide</b><small>3 things need you today</small></span></div>
              </>} />
          </div>
        </section>

        {/* ---------- Three feature stories ---------- */}
        <section className="hb-section" id="features">
          <div className="hb-wrap">
            <Editorial note="Boards for the whole team" index="01" title="Every way of working, on *one calm board*.">
              <p className="hb-copy">Drag cards across columns, see who’s on what with several assignees per card, set WIP limits and group by person, priority or epic. Managers plan; the team moves the work.</p>
              <ul className="hb-ticks"><li>Swimlanes & WIP limits</li><li>Sprints, backlog & timeline</li><li>Live updates for everyone</li></ul>
            </Editorial>
            <Shot src={shotBoard} alt="A WorkMars board with cards in To do, In progress, In review and Done" tint="sea" critter={{ kind: 'bird', at: 'top-left' }} />
          </div>
        </section>

        <section className="hb-section">
          <div className="hb-wrap">
            <Editorial note="Your own list, next to team work" index="02" title="My day, with reminders that *find you*.">
              <p className="hb-copy">A private to-do list for managers and makers alike. Pin tasks from any project, split your day into morning, afternoon and evening, and get a nudge on your phone at exactly the right time.</p>
              <ul className="hb-ticks"><li>Reminders by push & email</li><li>Unfinished items roll forward</li><li>Only you can see it</li></ul>
            </Editorial>
            <Shot src={shotDay} alt="My day: a personal to-do list with a progress ring" tint="sun" critter={{ kind: 'snail', at: 'bottom-left' }} />
          </div>
        </section>

        <section className="hb-section">
          <div className="hb-wrap">
            <Editorial note="Free AI, built in" index="03" title="Ask the Mars guide, get a *plan*.">
              <p className="hb-copy">It reads your real board to plan your day, write your stand-up, spot what’s at risk and turn a plain sentence into a work item. No paid AI, no limits.</p>
            </Editorial>
            <div className="hb-guide-row">
              <Shot src={shotReports} alt="Reports: burndown, velocity and work by person" tint="lilac" critter={{ kind: 'alien', at: 'top-right' }} />
              <div className="hb-glass hb-console" data-reveal aria-label="Example conversation with the Mars guide">
                <div className="hb-console-head"><span className="hb-ai-dot" /><b>Mars guide</b><small>reads your workspace · free</small></div>
                <p className="hb-msg me" style={{ '--t': 0 } as CSSProperties}>Plan my day</p>
                <div className="hb-msg ai" style={{ '--t': 1 } as CSSProperties}>
                  <b>A calm plan for today</b>
                  <ol><li><code>WEB-102</code> Fix sign-in errors <em className="hb-chip mars">urgent</em></li><li><code>WEB-106</code> Map navigation <em className="hb-chip sun">high</em></li><li><code>WEB-101</code> Landing layout <em className="hb-chip sun">high</em></li></ol>
                </div>
                <p className="hb-msg me" style={{ '--t': 2 } as CSSProperties}>urgent bug: checkout fails on Safari, due Friday</p>
                <div className="hb-msg ai draft" style={{ '--t': 3 } as CSSProperties}>
                  <small>Draft work item</small><b>Checkout fails on Safari</b>
                  <span className="hb-tags"><i>Bug</i><i>Urgent</i><i>Due Fri</i></span>
                  <span className="hb-btn dark sm">Create <Icon name="arrow" size={12} /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Four setup tiles ---------- */}
        <section className="hb-section">
          <div className="hb-wrap">
            <Editorial note="Get going" index="04" title="From sign-up to *shipping* in four steps." />
            <div className="hb-tiles">
              {STEPS.map((s, i) => (
                <article key={s.title} className={`hb-tile t${i}`} data-reveal style={{ '--d': `${i * 80}ms` } as CSSProperties}>
                  <Spot kind={s.spot} />
                  <p className="hb-num">{s.n}<small>{s.unit}</small></p>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Methods ---------- */}
        <section className="hb-section" id="methods">
          <div className="hb-wrap">
            <Editorial note="Every way of working" index="05" title="Pick a method. Switch *any time*.">
              <p className="hb-copy">Each one sets up the right board, views, terms and reports. Change your mind later without losing a single card.</p>
            </Editorial>
            <div className="hb-methods">
              {METHODS.map((m, i) => (
                <div key={m.name} className={`hb-glass hb-method c-${m.color}`} data-reveal style={{ '--d': `${(i % 4) * 60}ms`, '--r': `${(i % 3) - 1}deg` } as CSSProperties}>
                  <span className="hb-method-dot" /><b>{m.name}</b><small>{m.blurb}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Feature index ---------- */}
        <section className="hb-section">
          <div className="hb-wrap">
            <Editorial note="Everything included" index="06" title="All of it, for *everyone*." />
            <ul className="hb-index-list">
              {INDEX.map(([icon, title, body], i) => (
                <li key={title} data-reveal style={{ '--d': `${(i % 3) * 60}ms` } as CSSProperties}>
                  <span className={`hb-ico c${i % 5}`}><Icon name={icon} size={16} /></span>
                  <span><b>{title}</b><small>{body}</small></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Pricing ---------- */}
        <section className="hb-section" id="pricing">
          <div className="hb-wrap">
            <Editorial note="Pricing" index="07" title="One plan. It costs *nothing*." />
            <div className="hb-pricing">
              <article className="hb-plan featured" data-reveal>
                <span className="hb-ribbon">Everyone</span>
                <h3>WorkMars</h3>
                <p className="hb-price"><b>$0</b><span>per person / month<br />forever</span></p>
                <ul>{['Unlimited people & projects', 'Every method, board and report', 'Roles, project teams & several assignees', 'Reminders, push & email notifications', 'Free Mars guide AI', 'Phone, tablet & desktop app'].map((f) => <li key={f}><Icon name="check" size={14} /> {f}</li>)}</ul>
                <Link to="/signup" className="hb-btn dark wide">Create your workspace <Icon name="arrow" size={15} /></Link>
              </article>
              <article className="hb-plan" data-reveal style={{ '--d': '100ms' } as CSSProperties}>
                <span className="hb-ribbon soft">Your server</span>
                <h3>Self-hosted</h3>
                <p className="hb-price"><b>$0</b><span>run it on your own<br />machine or cloud</span></p>
                <ul>{['One SQLite file or Postgres / Supabase', 'Your data never leaves your database', 'Bring your own email & push keys', 'Optional local AI with Ollama', 'Updates with one command', 'No licence keys, no limits'].map((f) => <li key={f}><Icon name="check" size={14} /> {f}</li>)}</ul>
                <Link to="/signup" className="hb-btn quiet wide">Try it now</Link>
              </article>
              <Critter kind="cat" className="hb-plan-cat" />
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="hb-section" id="faq">
          <div className="hb-wrap">
            <Editorial note="Questions" index="08" title="Good to *know*." />
            <div className="hb-faq">
              {FAQ.map(([q, a]) => (
                <details key={q} data-reveal>
                  <summary>{q}<span className="hb-plus" aria-hidden="true" /></summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Footer with the village ---------- */}
      <footer className="hb-footer">
        <div className="hb-wrap">
          <div className="hb-footer-cta" data-reveal>
            <h2 className="hb-h2"><Marked text="Bring your whole crew to the *harbour*." /></h2>
            <div className="hb-actions">
              <Link to="/signup" className="hb-btn dark lg">Start free <Icon name="arrow" size={15} /></Link>
              <Link to="/login" className="hb-btn quiet lg">Log in</Link>
            </div>
          </div>
          <div className="hb-footer-cols">
            <div className="hb-footer-brand"><Brand to="/welcome" height={28} /><p>Free project management for unlimited people. No ads. Your data stays yours.</p></div>
            <div><h4>Product</h4><button onClick={() => go('features')}>Features</button><button onClick={() => go('methods')}>Methods</button><button onClick={() => go('pricing')}>Pricing</button></div>
            <div><h4>Account</h4><Link to="/signup">Sign up</Link><Link to="/login">Log in</Link><Link to="/forgot-password">Reset password</Link></div>
            <div><h4>Help</h4><button onClick={() => go('faq')}>FAQ</button><InstallButton className="hb-linkish" /></div>
          </div>
          <p className="hb-legal">© {new Date().getFullYear()} WorkMars · Made for teams who would rather ship than pay per seat.</p>
        </div>
        <Village />
      </footer>
    </div>
  );
}
