import { useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Logo, Mark } from '../../components/Logo';
import { FloatingRocks, type Rock } from '../../components/FloatingRocks';
import { useSession } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { useReveal, useScrollVars, useTypewriter } from '../../lib/motion';

export function Brand({ to = '/', onDark = false, height = 28 }: { to?: string; onDark?: boolean; height?: number }) {
  return (
    <Link to={to} className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="WorkMars home">
      <Logo onDark={onDark} height={height} />
    </Link>
  );
}

/* Martian rocks drifting around the public page (see FloatingRocks). Kept to
   the margins so they frame the copy rather than cover it. */
const HERO_ROCKS: Rock[] = [
  { art: 'boulder', x: '2%', y: '22%', size: 200, depth: .55, rot: -10, float: 9, phone: { x: '-52px', y: '300px' } },
  { art: 'pebbleA', x: '13%', y: '9%', size: 56, depth: .95, rot: 12, float: 6.5 },
  { art: 'pebbleD', x: '17%', y: '47%', size: 34, depth: .2, rot: -30, float: 10, far: true },
  { art: 'slab', x: '84%', y: '10%', size: 180, depth: .4, rot: 16, float: 11, phone: { x: 'calc(100% - 40px)', y: '0px' } },
  { art: 'pebbleB', x: '91%', y: '45%', size: 62, depth: .85, rot: -18, float: 7.5 },
  { art: 'pebbleC', x: '78%', y: '38%', size: 40, depth: .25, rot: 24, float: 9.5, far: true },
  { art: 'shard', x: '87%', y: '70%', size: 160, depth: .7, rot: -12, float: 8.5 },
  { art: 'pebbleA', x: '5%', y: '74%', size: 48, depth: .75, rot: 40, float: 7 },
];
const FINAL_ROCKS: Rock[] = [
  { art: 'shard', x: '6%', y: '8%', size: 150, depth: .6, rot: 20, float: 9, phone: { x: '-44px', y: '0px' } },
  { art: 'pebbleC', x: '20%', y: '62%', size: 50, depth: .9, rot: -14, float: 7 },
  { art: 'boulder', x: '82%', y: '30%', size: 170, depth: .5, rot: 8, float: 10.5 },
  { art: 'pebbleD', x: '74%', y: '6%', size: 38, depth: .3, rot: 30, float: 8, far: true },
  { art: 'pebbleB', x: '93%', y: '74%', size: 46, depth: .8, rot: -26, float: 6.5 },
];
const FEATURE_ROCKS: Rock[] = [
  { art: 'slab', x: '-2%', y: '6%', size: 140, depth: .45, rot: -24, float: 10 },
  { art: 'pebbleA', x: '95%', y: '18%', size: 44, depth: .8, rot: 18, float: 7 },
];

const TEAMS = ['Product teams', 'Engineering', 'Marketing', 'Operations', 'People & HR', 'Finance', 'Agencies', 'Founders', 'Schools', 'Charities', 'Consultancies', 'Creative studios'];
const TYPE_PHRASES = ['More clarity', 'More focus', 'More done'];

const FEATURES: [string, string, string, string][] = [
  ['sparkles', 'Mars guide — your free AI', 'Plans your day, spots blockers, sizes sprints and turns a sentence into a work item. No limits, no bill.', 'violet'],
  ['board', 'Boards that bend to you', 'Rename, reorder and colour columns, set WIP limits, and drag work with mouse, touch or keyboard.', 'blue'],
  ['inbox', 'Sprints & backlog', 'Plan, start and complete sprints. Unfinished work rolls forward and velocity is recorded for you.', 'amber'],
  ['timeline', 'Timeline & calendar', 'See epics and deadlines across the weeks ahead, then drag your attention to what is due next.', 'green'],
  ['chart', 'Reports that answer questions', 'Burndown, velocity, cycle time and workload — live, honest, and with a table view for every chart.', 'rose'],
  ['sun', 'My day, just for you', 'A private to-do list beside team work. Morning, afternoon, evening — and gentle roll-over.', 'teal'],
];

export function Welcome() {
  const { data } = useSession();
  const root = useRef<HTMLDivElement>(null);
  const [, setTheme, dark] = useTheme();
  useReveal(root);
  useScrollVars(root);
  const typed = useTypewriter(TYPE_PHRASES);

  if (data?.user) return <Navigate to="/" replace />;

  return (
    <div className="lp" ref={root}>
      <div className="lp-progress" aria-hidden="true" />
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Brand to="/welcome" />
          <nav className="lp-links" aria-label="Main">
            <a href="#what">About</a>
            <a href="#how">Product</a>
            <a href="#features">Features</a>
            <a href="#guide">AI guide</a>
          </nav>
          <div className="lp-actions">
            <button className="lp-icon" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}><Icon name={dark ? 'sun' : 'moon'} size={17} /></button>
            <Link to="/signup" className="pill pill-ghost lp-hide-sm"><Icon name="play" size={12} /> Try demo</Link>
            <Link to="/login" className="lp-login">Log in</Link>
            <Link to="/signup" className="pill pill-solid"><Icon name="sparkles" size={14} /> Get started</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero: the headline recedes as the product rises into place */}
        <section className="lp-hero" data-scroll="exit">
          <FloatingRocks rocks={HERO_ROCKS} />
          <div className="lp-wrap lp-hero-copy">
            <span className="lp-chip enter" style={{ ['--d' as string]: '0ms' }}><span className="dot" /> Free for unlimited users · forever</span>
            <h1 className="lp-h1">
              {['Work', 'beautifully,', 'together.'].map((w, i) => <span key={w} className={`enter word ${i === 2 ? 'serif-accent' : ''}`} style={{ ['--d' as string]: `${120 + i * 110}ms` }}>{w}&nbsp;</span>)}
            </h1>
            <p className="lp-sub enter" style={{ ['--d' as string]: '480ms' }}><b>WorkMars</b> runs your team’s projects in minutes. Boards, sprints, timelines and a free AI guide — in one calm space.</p>
            <div className="lp-cta enter" style={{ ['--d' as string]: '600ms' }}>
              <Link to="/signup" className="pill pill-solid pill-lg">Get started free <Icon name="right" size={15} /></Link>
              <a href="#how" className="pill pill-ghost pill-lg">See how it works</a>
            </div>
          </div>
          <div className="lp-wrap">
            <div className="lp-shot enter" style={{ ['--d' as string]: '760ms' }}><ProductShot /></div>
          </div>
        </section>

        <section className="lp-trust" aria-label="Who WorkMars is for">
          <p className="lp-kicker">BUILT FOR EVERY KIND OF TEAM</p>
          <div className="lp-marquee"><div className="lp-marquee-track">{[...TEAMS, ...TEAMS].map((t, i) => <span key={i}>{t}</span>)}</div></div>
        </section>

        {/* Stacked sticky cards */}
        <section className="lp-wrap lp-stack">
          <article className="lp-card" data-stack id="what">
            <div className="lp-card-copy">
              <h2 className="lp-h2">What is<br /><em>WorkMars?</em></h2>
              <p>Most project tools force you into their complex systems — and charge per seat for the privilege. WorkMars is different. Set up in a minute, invite everyone for free, and let the board, the sprints and your Mars guide keep work moving. Every department, every project, one simple workspace.</p>
            </div>
            <div className="lp-card-visual lp-type">
              <p>More <em>people</em></p>
              <p>More <em>projects</em></p>
              <p className="typed" aria-live="polite">{typed}<span className="caret" aria-hidden="true" /></p>
            </div>
          </article>

          <article className="lp-card lp-card-grey" data-stack id="how">
            <div className="lp-card-copy">
              <h2 className="lp-h2">How does<br /><em>it work?</em></h2>
              <p>Capture work as cards, drag it across your board, plan sprints in the backlog and watch progress in reports. When you’re unsure what’s next, ask the Mars guide — it reads your real work and tells you.</p>
              <Link to="/signup" className="pill pill-solid">Try for free <Icon name="right" size={14} /></Link>
            </div>
            <div className="lp-card-visual"><MiniBoard /></div>
          </article>

          <article className="lp-card" data-stack>
            <div className="lp-card-copy">
              <h2 className="lp-h2">WorkMars builds<br /><em>around you</em></h2>
              <p>Tell us your role, your region and how your team likes to work. We set up the right workflow — Scrum, Kanban or simple approvals — with UK, US or Asia date formats, ready in under a minute.</p>
              <Link to="/signup" className="pill pill-solid">Try for free <Icon name="right" size={14} /></Link>
            </div>
            <div className="lp-card-visual lp-idea">
              <Mark size={34} />
              <small>ZERO TO RUNNING</small>
              <p className="serif">From idea<br /><i>to workspace</i></p>
              <ol className="lp-steps">
                {['Your role', 'Workspace & region', 'Workflow', 'Invite team'].map((s, i) => <li key={s} style={{ ['--i' as string]: i }}><span>{i + 1}</span>{s}</li>)}
              </ol>
            </div>
          </article>
        </section>

        <section className="lp-section lp-grey" id="features">
          <FloatingRocks rocks={FEATURE_ROCKS} />
          <div className="lp-wrap">
            <h2 className="lp-h2 xl" data-reveal>You’re in<br /><em>control</em></h2>
            <div className="lp-features">
              {FEATURES.map(([icon, title, body, tone], i) => (
                <article key={title} className="lp-feature" data-reveal style={{ ['--i' as string]: i }}>
                  <span className={`lp-ficon ${tone}`}><Icon name={icon} size={18} /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className="lp-split" data-reveal>
              <h2 className="lp-h2 xl">One platform<br /><em>zero limits</em></h2>
              <div>
                <p className="lp-lead">An open workspace for every team you work with. WorkMars is free for unlimited users, runs on your own server if you like, and keeps your data out of third-party AI services.</p>
                <Link to="/signup" className="pill pill-solid">Start for free</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="guide">
          <div className="lp-wrap lp-guide">
            <div data-reveal>
              <div className="lp-avatars"><span>AM</span><span>SC</span><span>JW</span><span className="ai"><Icon name="sparkles" size={15} /></span></div>
              <h2 className="lp-h2">Meet your <em>Mars guide</em></h2>
              <p className="lp-lead">Ask in plain English. It reads your real board and answers — then does the work when you say yes.</p>
            </div>
            <div className="lp-chat" data-reveal style={{ ['--i' as string]: 1 }}>
              <div className="lp-msg me">Create an urgent bug: checkout fails on Safari, assign to me, due Friday</div>
              <div className="lp-msg ai"><b>Here’s the draft for WEB.</b><br />Checkout fails on Safari · Bug · Urgent<br />Assignee: you · Due: Fri 17 Oct<span className="lp-msg-btn">Create work item</span></div>
              <div className="lp-msg me">What needs attention today?</div>
              <div className="lp-msg ai typing" aria-label="Mars guide is typing"><i /><i /><i /></div>
              <div className="lp-chat-input"><Icon name="plus" size={14} /> Ask about your work… <span>Free · no limits</span></div>
            </div>
          </div>
        </section>

        <section className="lp-section lp-final">
          <FloatingRocks rocks={FINAL_ROCKS} />
          <div className="lp-wrap" data-reveal>
            <h2 className="lp-h2 xl">Ready to grow <em>your team?</em></h2>
            <p className="lp-lead">Start in under a minute and let WorkMars handle the rest.</p>
            <Link to="/signup" className="pill pill-solid pill-lg">Try for free <Icon name="right" size={15} /></Link>
          </div>
        </section>
      </main>

      <footer className="lp-wrap">
        <div className="lp-footer" data-reveal>
          <div className="lp-foot-top">
            <div><Brand to="/welcome" height={30} /><span className="brand-tagline">Build <i>/</i> Automate <i>/</i> Grow</span><p>Free project management for unlimited users. Made in the UK for teams everywhere.</p></div>
            {[
              ['Product', [['Features', '#features'], ['How it works', '#how'], ['AI guide', '#guide']]],
              ['Get started', [['Create account', '/signup'], ['Log in', '/login']]],
              ['Principles', [['No seat limits', '#features'], ['Your data stays yours', '#guide'], ['Accessible by design', '#features']]],
            ].map(([title, links]) => (
              <div key={title as string} className="lp-foot-col">
                <b>{title}</b>
                {(links as string[][]).map(([l, href]) => href.startsWith('/') ? <Link key={l} to={href}>{l}</Link> : <a key={l} href={href}>{l}</a>)}
              </div>
            ))}
          </div>
          <div className="lp-badges">
            {[['shield', 'GDPR-minded', 'Data minimised by design'], ['eye', 'WCAG 2.2 AA', 'Keyboard & screen-reader friendly'], ['lock', 'Private AI', 'No third-party AI services'], ['heart', 'Free forever', 'Unlimited users']].map(([icon, t, s]) => (
              <div key={t}><span><Icon name={icon} size={17} /></span><p><b>{t}</b><small>{s}</small></p></div>
            ))}
          </div>
          <p className="lp-copy">© {new Date().getFullYear()} WorkMars. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/** A faithful, static rendering of the WorkMars overview for the hero. */
function ProductShot() {
  const bars = [38, 52, 46, 61, 58, 74, 69, 86];
  return (
    <div className="shot" aria-hidden="true">
      <div className="shot-top">
        <span className="shot-brand"><Logo height={16} /></span>
        <span className="shot-search"><Icon name="search" size={11} /> Search or jump to…</span>
        <span className="shot-pill"><Icon name="sparkles" size={10} /> Mars guide</span>
        <span className="shot-av">AM</span>
      </div>
      <div className="shot-body">
        <div className="shot-rail">{['grid', 'board', 'inbox', 'timeline', 'calendar', 'chart', 'sun', 'people'].map((i, n) => <span key={i} className={n === 0 ? 'on' : ''}><Icon name={i} size={13} /></span>)}</div>
        <div className="shot-main">
          <div className="shot-tabs"><b>Overview</b><span>Board</span><span>Backlog</span><span>Timeline</span><span>Reports</span><em>Last 14 days ▾</em><strong>Create task</strong></div>
          <div className="shot-metrics">
            {[['Total work items', '128', '+12 this week'], ['Completed', '86', '67% done'], ['In progress', '24', 'Active now'], ['Sprint', '9 days', 'WEB Sprint 4'], ['Overdue', '2', 'Need attention']].map(([l, v, s]) => (
              <div key={l}><small>{l}</small><b>{v}</b><i>{s}</i></div>
            ))}
          </div>
          <div className="shot-grid">
            <div className="shot-panel">
              <small>Delivered — last 8 weeks</small>
              <svg viewBox="0 0 240 90" preserveAspectRatio="none">
                <defs><linearGradient id="shotfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#a66b48" stopOpacity=".28" /><stop offset="1" stopColor="#a66b48" stopOpacity="0" /></linearGradient></defs>
                <path d={`M0,90 ${bars.map((b, i) => `L${(i * 240) / 7},${90 - b}`).join(' ')} L240,90 Z`} fill="url(#shotfill)" />
                <path d={bars.map((b, i) => `${i ? 'L' : 'M'}${(i * 240) / 7},${90 - b}`).join(' ')} fill="none" stroke="#6f3e25" strokeWidth="1.6" />
                {bars.map((b, i) => <circle key={i} cx={(i * 240) / 7} cy={90 - b} r="2.2" fill="#6f3e25" />)}
              </svg>
            </div>
            <div className="shot-panel">
              <small>Up next</small>
              {[['Design landing page', 'High', 'v'], ['Fix sign-in errors', 'Urgent', 'r'], ['Audit user journeys', 'High', 'a'], ['Write release notes', 'Low', 'g']].map(([t, p, c]) => (
                <div key={t} className="shot-row"><i className={c} />{t}<em className={c}>{p}</em></div>
              ))}
            </div>
            <div className="shot-panel shot-donut">
              <small>Status mix</small>
              <svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.9" fill="none" stroke="#f7eee2" strokeWidth="6" />
                {[[67, '#6f3e25', 0], [19, '#88accc', 67], [9, '#e4b768', 86], [5, '#d59388', 95]].map(([v, c, o]) => <circle key={c as string} cx="21" cy="21" r="15.9" fill="none" stroke={c as string} strokeWidth="6" strokeDasharray={`${v} ${100 - (v as number)}`} strokeDashoffset={25 - (o as number)} />)}
              </svg>
              <ul><li><i style={{ background: '#6f3e25' }} />Done 67%</li><li><i style={{ background: '#88accc' }} />Doing 19%</li><li><i style={{ background: '#e4b768' }} />Review 9%</li></ul>
            </div>
          </div>
          <div className="shot-ask"><Icon name="sparkles" size={10} /> Ask Mars guide</div>
        </div>
      </div>
    </div>
  );
}

/** Cards that glide across columns on a loop — the board in miniature. */
function MiniBoard() {
  return (
    <div className="mini" aria-hidden="true">
      {['To do', 'In progress', 'Done'].map((c, i) => (
        <div key={c} className="mini-col"><b><i className={`c${i}`} />{c}</b>
          {[0, 1].map((n) => <span key={n} className="mini-card"><em className={`t${(i + n) % 3}`} /><span /><span className="short" /></span>)}
        </div>
      ))}
      <span className="mini-card mini-fly"><em className="t0" /><span /><span className="short" /></span>
    </div>
  );
}
