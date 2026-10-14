import { Link, Navigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSession } from '../../lib/queries';

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="Flowstate home">
      <span className="logo-mark"><Icon name="sparkles" size={24} /></span>
      <span className="brand-name">flowstate<span className="brand-dot">.</span></span>
    </Link>
  );
}

const FEATURES = [
  ['board', 'Boards your team will love', 'Drag work across columns that match how you actually work. Set WIP limits to stay in flow.'],
  ['inbox', 'Sprints & backlog', 'Plan sprints, track velocity and burndown — everything Scrum teams expect, minus the clutter.'],
  ['timeline', 'Timeline & calendar', 'See the road ahead with a clean roadmap and a month view of every deadline.'],
  ['sun', 'My day, just for you', 'A private daily to-do list beside your team work. Unfinished items roll forward gently.'],
  ['sparkles', 'A free AI guide', 'Plan your day, spot blockers, write your stand-up, or create tasks from a sentence. Always free.'],
  ['chart', 'Reports that answer questions', 'Burndown, velocity, cycle time and workload — live, honest and easy to read.'],
] as const;

const PREVIEW = [
  { col: 'To do', dot: '#9698ab', cards: [['WEB-104', 'Audit current user journeys', 'high', 'Research', '#e99b83', 'SC']] },
  { col: 'In progress', dot: '#6a8ee9', cards: [['WEB-101', 'Design new landing page layout', 'high', 'Design', '#6e6ad7', 'AM'], ['WEB-102', 'Build UI component library', 'medium', 'Development', '#59a8b0', 'JW']] },
  { col: 'Done', dot: '#28b391', cards: [['WEB-107', 'Map navigation structure', 'medium', 'UX', '#dba961', 'ET']] },
] as const;

export function Welcome() {
  const { data } = useSession();
  if (data?.user) return <Navigate to="/" replace />;
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand to="/welcome" />
        <nav className="landing-links" aria-label="Main">
          <a href="#features">Features</a>
          <a href="#free">Pricing</a>
          <Link to="/login" className="btn btn-light">Sign in</Link>
          <Link to="/signup" className="btn btn-primary">Get started free</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-copy">
            <div className="eyebrow"><span className="line" />Project management, reimagined</div>
            <h1>Work beautifully,<br /><span className="grad-text">together.</span></h1>
            <p>Flowstate brings boards, sprints, timelines and a personal to-do list into one calm space — with a free AI guide that shows you the way. <b>Free for unlimited users. Forever.</b></p>
            <div className="landing-cta">
              <Link to="/signup" className="btn btn-primary btn-xl">Create your free workspace <Icon name="right" size={16} /></Link>
              <Link to="/login" className="btn btn-light btn-xl">I already have an account</Link>
            </div>
            <ul className="landing-trust">
              <li><Icon name="check" size={15} /> No credit card, no trial</li>
              <li><Icon name="check" size={15} /> Unlimited people & projects</li>
              <li><Icon name="check" size={15} /> UK-first, GDPR-minded</li>
            </ul>
          </div>

          <div className="landing-preview" aria-hidden="true">
            <div className="project-hero" style={{ marginBottom: 14 }}>
              <div className="hero-content">
                <div className="hero-overline"><Icon name="bolt" size={13} /> Sprint 04 · 9 days left</div>
                <h2>Website Redesign</h2>
                <p>A more intuitive digital experience, crafted together.</p>
              </div>
              <div className="hero-right"><div className="hero-metric"><strong>64%</strong><span>work completed</span></div></div>
            </div>
            <div className="preview-board">
              {PREVIEW.map((c) => (
                <div className="kanban-col" key={c.col} style={{ minHeight: 0 }}>
                  <div className="col-title"><span className="col-dot" style={{ background: c.dot }} /><b>{c.col}</b><span className="col-count">{c.cards.length}</span></div>
                  {c.cards.map(([id, title, pri, label, color, ini]) => (
                    <article className="task-card" key={id}>
                      <div className="card-top"><span className="issue-id">{id}</span><span className={`priority ${pri}`}><Icon name="flag" size={11} /> {pri[0].toUpperCase() + pri.slice(1)}</span></div>
                      <div className="task-title">{title}</div>
                      <div className="card-footer"><span className="task-tag">{label}</span><span className="avatar card-avatar" style={{ background: color }}>{ini}</span></div>
                    </article>
                  ))}
                </div>
              ))}
            </div>
            <div className="preview-guide">
              <span className="ai-bot"><Icon name="sparkles" size={18} /></span>
              <div><b>Flow guide</b><p>2 items need attention today — WEB-106 is urgent and due now. Want me to plan your day?</p></div>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="eyebrow center"><span className="line" />Everything in one place</div>
          <h2 className="landing-h2">All the power of the big tools.<br />None of the noise.</h2>
          <div className="feature-grid">
            {FEATURES.map(([icon, title, body]) => (
              <article className="content-card feature-card" key={title}>
                <span className="metric-symbol" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={icon} size={18} /></span>
                <h3>{title}</h3>
                <p className="muted">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="free" className="landing-section">
          <div className="free-band">
            <div>
              <span className="mini-label">FREE. NO SEAT LIMITS.</span>
              <h2>Make room for everyone.</h2>
              <p>Every feature, every user, every project — free. Invite your whole company, your clients and your freelancers. The AI guide is free too, with no usage caps.</p>
            </div>
            <Link to="/signup" className="btn btn-primary btn-xl">Start in under a minute <Icon name="arrow" size={15} /></Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Flowstate · Made in the UK for teams everywhere</span>
        <span>Built with care for accessibility (WCAG 2.2 AA)</span>
      </footer>
    </div>
  );
}
