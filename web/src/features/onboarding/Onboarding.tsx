import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { keys, useSession } from '../../lib/queries';
import { Icon } from '../../components/Icon';
import { Brand } from '../auth/Welcome';
import type { MethodologyId, Session, Workspace } from '../../lib/types';
import { MethodologyPicker } from '../../components/MethodologyPicker';
import { METHODOLOGIES } from '../../lib/methodology';
import { accentTitle } from '../../components/ui';
import { DesignationSelect } from '../team/DesignationSelect';

const ROLES = [
  ['Engineering', 'bolt'], ['Product', 'target'], ['Design', 'sparkles'], ['Marketing', 'trend'],
  ['Operations', 'settings'], ['People & HR', 'people'], ['Finance', 'chart'], ['Founder / Leadership', 'flag'], ['Something else', 'lightbulb'],
] as const;
const SIZES = ['Just me', '2–10', '11–50', '51–200', '201–1,000', '1,000+'];
const REGIONS = [
  { id: 'uk', label: 'United Kingdom', sample: '14 Oct 2026 · weeks start Monday', flag: '🇬🇧' },
  { id: 'us', label: 'United States', sample: 'Oct 14, 2026 · weeks start Sunday', flag: '🇺🇸' },
  { id: 'asia', label: 'Asia-Pacific', sample: '14 Oct 2026 · weeks start Monday', flag: '🌏' },
  { id: 'other', label: 'Somewhere else', sample: '14 Oct 2026 · weeks start Monday', flag: '🌍' },
] as const;
/** A sensible starting point per role; the picker's questions refine it. */
const RECOMMENDED: Record<string, MethodologyId> = {
  Engineering: 'scrumban', Product: 'scrum', Design: 'kanban', Operations: 'kanban', Marketing: 'kanban', 'People & HR': 'business', Finance: 'waterfall', 'Founder / Leadership': 'lean',
};

function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'PRJ').slice(0, 4);
  return (/^[A-Z]/.test(key) ? key : 'P' + key).slice(0, 6);
}

const STEPS = ['You', 'Workspace', 'Project', 'Team', 'Ready'];

export function Onboarding() {
  const { data: session } = useSession();
  const user = session!.user!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState('');
  const [ws, setWs] = useState({ name: '', region: 'uk', teamSize: '' });
  const [project, setProject] = useState({ name: '', key: '', keyTouched: false, methodology: '' as MethodologyId | '', withSamples: true });
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [inviteDesignation, setInviteDesignation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Workspace | null>(null);
  const [emailed, setEmailed] = useState(0);

  const methodology: MethodologyId = project.methodology || RECOMMENDED[role] || 'scrum';
  const key = project.keyTouched ? project.key : suggestKey(project.name || 'Project');
  const first = user.name.split(' ')[0];

  const canNext = useMemo(() => [
    !!role,
    ws.name.trim().length >= 2,
    project.name.trim().length >= 1 && /^[A-Z][A-Z0-9]{1,5}$/.test(key),
    true,
  ][step] ?? true, [step, role, ws.name, project.name, key]);

  function addEmails(raw: string) {
    const found = raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (found.length) setEmails((prev) => [...new Set([...prev, ...found])]);
    setDraft('');
  }
  const onEmailKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      addEmails(draft);
    } else if (e.key === 'Backspace' && !draft && emails.length) setEmails(emails.slice(0, -1));
  };

  async function finish() {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<Session & { workspace: Workspace; invites?: { email: string; emailed: boolean }[] }>('/workspaces', {
        name: ws.name.trim(), region: ws.region, teamSize: ws.teamSize, useCase: role, jobTitle: role === 'Something else' ? undefined : role,
        project: { name: project.name.trim(), key, methodology, withSamples: project.withSamples },
        invites: draft.trim() ? [...emails, ...draft.split(/[\s,;]+/).filter((s) => s.includes('@'))] : emails,
        inviteDesignation: inviteDesignation.trim(),
      });
      qc.setQueryData(keys.session, { user: res.user, workspaces: res.workspaces });
      try {
        localStorage.setItem('fs_last_ws', res.workspace.slug);
        localStorage.setItem(`fs_tour_${res.workspace.slug}`, '1');
      } catch {
        /* storage blocked */
      }
      setCreated(res.workspace);
      setEmailed((res.invites ?? []).filter((i) => i.emailed).length);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function next(e?: FormEvent) {
    e?.preventDefault();
    if (!canNext) return;
    if (step === 3) finish();
    else setStep(step + 1);
  }

  return (
    <div className="onboard">
      <header className="onboard-top">
        <Brand to="/" />
        <ol className="stepper" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
              <span>{i < step ? <Icon name="check" size={12} /> : i + 1}</span><em>{s}</em>
            </li>
          ))}
        </ol>
      </header>

      <form className="onboard-card" onSubmit={next}>
        {step === 0 && (
          <section className="onboard-step" key="s0">
            <div className="eyebrow"><span className="line" />Welcome, {first}</div>
            <h1 className="page-title">{accentTitle('What kind of work do you do?')}</h1>
            <p className="page-subtitle">We’ll tailor your first project and the Mars guide’s suggestions. You can change everything later.</p>
            <div className="chip-grid" role="radiogroup" aria-label="Your role">
              {ROLES.map(([r, icon]) => (
                <button type="button" key={r} role="radio" aria-checked={role === r} className={`choice-chip ${role === r ? 'selected' : ''}`} onClick={() => setRole(r)}>
                  <Icon name={icon} size={17} /> {r}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onboard-step" key="s1">
            <div className="eyebrow"><span className="line" />Your workspace</div>
            <h1 className="page-title">{accentTitle('Name your team’s home.')}</h1>
            <p className="page-subtitle">Usually your company or team name. Everyone you invite will meet here.</p>
            <label className="form-field">
              <span>Workspace name</span>
              <input className="text-input text-input-lg" autoFocus maxLength={60} value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} placeholder="e.g. Studio North" />
            </label>
            <fieldset className="form-field plain">
              <legend>Where is most of your team?</legend>
              <div className="region-grid">
                {REGIONS.map((r) => (
                  <button type="button" key={r.id} className={`region-card ${ws.region === r.id ? 'selected' : ''}`} aria-pressed={ws.region === r.id} onClick={() => setWs({ ...ws, region: r.id })}>
                    <span className="flag" aria-hidden="true">{r.flag}</span>
                    <b>{r.label}</b>
                    <small>{r.sample}</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="form-field plain">
              <legend>How many people will use WorkMars? <small className="muted-inline">(it’s free at any size)</small></legend>
              <div className="chip-row">
                {SIZES.map((s) => <button type="button" key={s} className={`choice-chip sm ${ws.teamSize === s ? 'selected' : ''}`} aria-pressed={ws.teamSize === s} onClick={() => setWs({ ...ws, teamSize: s })}>{s}</button>)}
              </div>
            </fieldset>
          </section>
        )}

        {step === 2 && (
          <section className="onboard-step" key="s2">
            <div className="eyebrow"><span className="line" />Your first project</div>
            <h1 className="page-title">{accentTitle('How will this project be run?')}</h1>
            <p className="page-subtitle">Choose the methodology that fits its scale and requirements — not sure? Use <b>Help me choose</b>. You can switch later without losing anything.</p>
            <MethodologyPicker value={methodology} onChange={(m) => setProject({ ...project, methodology: m })} />
            <div className="form-grid" style={{ marginTop: 18 }}>
              <label className="form-field">
                <span>Project name</span>
                <input className="text-input" maxLength={80} value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} placeholder="e.g. Website Redesign" autoFocus />
              </label>
              <label className="form-field">
                <span>Key <small className="muted-inline">— prefixes work items, like {key}-101</small></span>
                <input className="text-input mono" maxLength={6} value={key} onChange={(e) => setProject({ ...project, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''), keyTouched: true })} aria-invalid={!/^[A-Z][A-Z0-9]{1,5}$/.test(key)} />
              </label>
            </div>
            <label className="check-row big">
              <input type="checkbox" checked={project.withSamples} onChange={(e) => setProject({ ...project, withSamples: e.target.checked })} />
              <span><b>Add example work</b> so I can explore straight away <small>(easy to delete later)</small></span>
            </label>
          </section>
        )}

        {step === 3 && (
          <section className="onboard-step" key="s3">
            <div className="eyebrow"><span className="line" />Bring your team</div>
            <h1 className="page-title">{accentTitle('Work is better together.')}</h1>
            <p className="page-subtitle">Invite as many people as you like — WorkMars is free for unlimited users. You can also do this later.</p>
            {/* A div, not a label: a label would forward clicks to the first chip's remove button. */}
            <div className="form-field">
              <span id="invite-emails-label">Email addresses</span>
              <div className="email-chips" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
                {emails.map((em) => (
                  <span className="email-chip" key={em}>{em}<button type="button" aria-label={`Remove ${em}`} onClick={() => setEmails(emails.filter((x) => x !== em))}><Icon name="close" size={11} /></button></span>
                ))}
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEmailKey} onBlur={() => draft && addEmails(draft)}
                  onPaste={(e) => { e.preventDefault(); addEmails(e.clipboardData.getData('text')); }} placeholder={emails.length ? 'Add another…' : 'name@company.com, teammate@company.com'} autoFocus aria-labelledby="invite-emails-label" />
              </div>
            </div>
            {(emails.length > 0 || !!draft.trim()) && <DesignationSelect value={inviteDesignation} onChange={setInviteDesignation} label="Their designation" hint="Applies to everyone above. You can invite people with different designations later from the Team page." />}
            <div className="tip-box"><Icon name="lightbulb" size={18} /><span>Any email address works — Gmail, Outlook/Hotmail, Yahoo or company email. If invitation emails are switched on they’re sent straight away; you can always copy each person’s link from the Team page too.</span></div>
            {error && <div className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
          </section>
        )}

        {step === 4 && created && (
          <section className="onboard-step ready" key="s4">
            <div className="ready-burst" aria-hidden="true"><Icon name="sparkles" size={34} /></div>
            <h1 className="page-title">{accentTitle(`You’re all set, ${first}.`)}</h1>
            <p className="page-subtitle"><b>{created.name}</b> is ready with your <b>{project.name}</b> {METHODOLOGIES[methodology].name} project{emails.length ? ` and ${emails.length} invitation${emails.length === 1 ? '' : 's'}` : ''}.{emailed ? ` We’ve emailed ${emailed === 1 ? 'your invitation' : `all ${emailed} invitations`}.` : ''}</p>
            <div className="ready-grid">
              <div><Icon name={METHODOLOGIES[methodology].icon} size={18} /><b>{METHODOLOGIES[methodology].name}, set up properly</b><span>{METHODOLOGIES[methodology].tagline}</span></div>
              <div><Icon name="sun" size={18} /><b>My day</b><span>A private to-do list, just for you</span></div>
              <div><Icon name="sparkles" size={18} /><b>Mars guide</b><span>Free AI help in the corner, any time</span></div>
            </div>
            <button type="button" className="btn btn-primary btn-xl" autoFocus onClick={() => navigate(`/w/${created.slug}/p/${key}`, { replace: true })}>
              Open my project <Icon name="right" size={16} />
            </button>
          </section>
        )}

        {step < 4 && (
          <div className="onboard-actions">
            {step > 0 ? <button type="button" className="btn btn-light" onClick={() => setStep(step - 1)}><Icon name="left" size={15} /> Back</button> : <span />}
            <div className="row-8">
              <button className="btn btn-primary" type="submit" disabled={!canNext || busy}>
                {busy ? 'Setting things up…' : step === 3 ? (emails.length || draft ? 'Send invites & finish' : 'Skip & finish setup') : 'Continue'} {!busy && <Icon name="right" size={15} />}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
