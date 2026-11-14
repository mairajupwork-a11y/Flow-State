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
import { LogoUploader } from '../../components/WorkspaceAvatar';
import { DesignationSelect } from '../team/DesignationSelect';
import { accessForDesignation } from '../../../../shared/designations.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tech-industry niches, grouped. Each suggests a way of working; the picker's questions refine it. */
const NICHE_GROUPS: [string, [string, string, MethodologyId][]][] = [
  ['Build & ship', [
    ['Software development', 'keyboard', 'scrumban'], ['Web development', 'globe', 'kanban'], ['Mobile apps', 'phone', 'scrum'],
    ['SaaS & product', 'layers', 'scrum'], ['AI & machine learning', 'sparkles', 'scrumban'], ['Data & analytics', 'chart', 'kanban'],
    ['Game development', 'play', 'scrum'], ['Blockchain & Web3', 'diamond', 'scrum'],
  ]],
  ['Run & secure', [
    ['DevOps & cloud', 'settings', 'kanban'], ['Cybersecurity', 'shield', 'kanban'], ['QA & testing', 'checkcircle', 'kanban'],
    ['IT services & consulting', 'folder', 'scrumban'], ['IT support & operations', 'sliders', 'kanban'],
  ]],
  ['Tech industries', [
    ['E-commerce', 'inbox', 'kanban'], ['FinTech', 'trend', 'scrum'], ['HealthTech', 'heart', 'waterfall'], ['EdTech', 'lightbulb', 'scrum'],
  ]],
  ['Teams', [
    ['UI/UX & product design', 'image', 'kanban'], ['Digital marketing & growth', 'zap', 'kanban'], ['Content & media production', 'file', 'kanban'],
    ['Project & program management (PMO)', 'target', 'prince2'], ['People & HR', 'people', 'business'], ['Finance', 'list', 'waterfall'],
    ['Founder / Leadership', 'flag', 'lean'], ['Something else', 'grid', 'scrum'],
  ]],
];
const SIZES = ['Just me', '2–10', '11–50', '51–200', '201–1,000', '1,000+'];
const RECOMMENDED: Record<string, MethodologyId> = Object.fromEntries(NICHE_GROUPS.flatMap(([, list]) => list.map(([n, , m]) => [n, m])));
const LOCALES = ['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU'] as const;
/** Date format and first day of the week come from the browser — no need to ask. */
function browserRegion() {
  const lang = navigator.language || 'en-GB';
  const locale = ((LOCALES as readonly string[]).includes(lang) ? lang : 'en-GB') as (typeof LOCALES)[number];
  let firstDay: number | undefined;
  try {
    const loc = new Intl.Locale(lang) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    firstDay = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
  } catch { /* older browsers */ }
  const weekStart = firstDay ? (firstDay === 7 ? 0 : 1) : locale === 'en-US' ? 0 : 1;
  return { locale, weekStart };
}

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
  const [ws, setWs] = useState({ name: '', teamSize: '' });
  const [myTitle, setMyTitle] = useState('');
  const [project, setProject] = useState({ name: '', key: '', keyTouched: false, methodology: '' as MethodologyId | '' });
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [inviteDesignation, setInviteDesignation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
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

  /** Valid addresses become chips; anything else stays in the box with a message, never silently dropped. */
  function addEmails(raw: string) {
    const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const found = parts.map((s) => s.toLowerCase()).filter((s) => EMAIL_RE.test(s));
    const bad = parts.filter((s) => !EMAIL_RE.test(s.toLowerCase()));
    const merged = [...new Set([...emails, ...found])];
    if (found.length) setEmails(merged);
    setDraft(bad.join(', '));
    setEmailError(bad.length ? `“${bad[0]}” isn’t an email address — check it or remove it.` : '');
    return bad.length ? null : merged;
  }
  const onEmailKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      addEmails(draft);
    } else if (e.key === 'Backspace' && !draft && emails.length) setEmails(emails.slice(0, -1));
  };

  async function finish(invites: string[] = emails) {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<Session & { workspace: Workspace; invites?: { email: string; emailed: boolean }[] }>('/workspaces', {
        name: ws.name.trim(), ...browserRegion(), teamSize: ws.teamSize, useCase: role, jobTitle: myTitle.trim() || undefined,
        project: { name: project.name.trim(), key, methodology },
        invites,
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
    if (step === 3) {
      const invites = draft.trim() ? addEmails(draft) : emails;
      if (invites) finish(invites);
      return;
    }
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
            <p className="page-subtitle">We’ll tailor your first project to how you work. You can change everything later.</p>
            <div className="niche-groups" role="radiogroup" aria-label="Your field">
              {NICHE_GROUPS.map(([group, list]) => (
                <div key={group} className="niche-group">
                  <div className="niche-title">{group}</div>
                  <div className="chip-grid niche-grid">
                    {list.map(([r, icon]) => (
                      <button type="button" key={r} role="radio" aria-checked={role === r} className={`choice-chip ${role === r ? 'selected' : ''}`} onClick={() => setRole(r)}>
                        <Icon name={icon} size={17} /> {r}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <DesignationSelect value={myTitle} onChange={setMyTitle} label="Your designation"
              hint="You’re the admin of this workspace. Your designation is shown to your team — change it anytime." />
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
                <input value={draft} onChange={(e) => { setDraft(e.target.value); setEmailError(''); }} aria-invalid={!!emailError} aria-describedby={emailError ? 'invite-emails-error' : undefined} onKeyDown={onEmailKey} onBlur={() => draft && addEmails(draft)}
                  onPaste={(e) => { e.preventDefault(); addEmails(e.clipboardData.getData('text')); }} placeholder={emails.length ? 'Add another…' : 'name@company.com, teammate@company.com'} autoFocus aria-labelledby="invite-emails-label" />
              </div>
            </div>
            {emailError && <div className="form-error" id="invite-emails-error" role="alert">{emailError}</div>}
            {(emails.length > 0 || !!draft.trim()) && <DesignationSelect value={inviteDesignation} onChange={setInviteDesignation} label="Their designation" hint={`Applies to everyone above, and they join your first project. ${inviteDesignation ? `As ${inviteDesignation}, they’ll be ${accessForDesignation(inviteDesignation) === 'manager' ? 'managers — able to create cards, set dates and assign people' : 'team members — able to comment, upload files, add links and move cards'}.` : 'Managers (PMs, team leads…) plan and assign work; team members do it.'} You can change this on the Team page.`} />}
            <div className="tip-box"><Icon name="lightbulb" size={18} /><span>Any email address works — Gmail, Outlook/Hotmail, Yahoo or company email. If invitation emails are switched on they’re sent straight away; you can always copy each person’s link from the Team page too.</span></div>
            {error && <div className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
          </section>
        )}

        {step === 4 && created && (
          <section className="onboard-step ready" key="s4">
            <h1 className="page-title">{accentTitle(`You’re all set, ${first}.`)}</h1>
            <p className="page-subtitle"><b>{created.name}</b> is ready with your <b>{project.name}</b> {METHODOLOGIES[methodology].name} project{emails.length ? ` and ${emails.length} invitation${emails.length === 1 ? '' : 's'}` : ''}.{emailed ? ` We’ve emailed ${emailed === 1 ? 'your invitation' : `all ${emailed} invitations`}.` : ''}</p>
            <div className="ready-logo">
              <LogoUploader slug={created.slug} name={created.name} logo={created.logo} onChange={(logo) => setCreated({ ...created, logo })} />
              <small>Optional — you can add or change it later in Settings.</small>
            </div>
            <div className="ready-grid">
              <div><Icon name={METHODOLOGIES[methodology].icon} size={18} /><b>{METHODOLOGIES[methodology].name}, set up properly</b><span>{METHODOLOGIES[methodology].tagline}</span></div>
              <div><Icon name="sun" size={18} /><b>My day</b><span>A private to-do list, just for you</span></div>
              <div><Icon name="people" size={18} /><b>Your team</b><span>Invite people and give each a role</span></div>
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
