import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { keys, useProviders, useSession } from '../../lib/queries';
import type { Session } from '../../lib/types';
import { Brand } from './Welcome';

const DEMO = import.meta.env.MODE === 'demo';

/** Friendly checks before calling the server, so messages always match what's on screen. */
function validate(mode: 'login' | 'signup', f: { name: string; email: string; password: string }): string | null {
  if (mode === 'signup' && !f.name.trim()) return 'Please enter your full name.';
  if (!f.email.trim()) return 'Please enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'That email address doesn’t look right — please check it.';
  if (!f.password) return mode === 'signup' ? 'Please choose a password (at least 8 characters).' : 'Please enter your password.';
  if (mode === 'signup' && f.password.length < 8) return 'Your password needs at least 8 characters.';
  return null;
}

/** Full-page redirect to Google's account chooser via the server's OAuth flow. */
function GoogleButton({ available, next, label, onUnavailable }: { available?: boolean; next: string | null; label: string; onUnavailable: (msg: string) => void }) {
  const [going, setGoing] = useState(false);
  const go = () => {
    if (available === false) return onUnavailable('Google sign-in isn’t switched on for this Flowstate yet. The administrator can enable it — see GOOGLE.md. You can use email for now.');
    setGoing(true);
    window.location.assign(`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  };
  return (
    <button type="button" className="btn btn-google btn-block btn-xl" onClick={go} disabled={going || available === undefined}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {going ? 'Opening Google…' : label}
    </button>
  );
}

/** Fixed messages for ?error codes from the Google redirect; unknown codes show nothing. */
const REDIRECT_ERRORS: Record<string, string> = {
  google_off: 'Google sign-in is not set up on this server yet.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_incomplete: 'Google sign-in did not complete. Please try again.',
  google_expired: 'Your Google sign-in expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_unverified: 'Your Google account email is not verified, so it cannot be used to sign in.',
};

/** Only paths on this site (browsers treat `/\\host` like `//host`). */
export function sameSitePath(next: string | null): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, location.origin);
    return url.origin === location.origin && next.startsWith('/') ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { data } = useSession();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = sameSitePath(next);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setFormState] = useState({ name: '', email: params.get('email') ?? '', password: '' });
  // Errors from a Google redirect arrive as ?error=…; typing clears any stale message.
  const [error, setError] = useState(() => REDIRECT_ERRORS[params.get('error') ?? ''] ?? '');
  const setForm = (next: typeof form) => { setFormState(next); if (error) setError(''); };
  const providers = useProviders();
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  if (data?.user && !busy) return <Navigate to={safeNext ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate(mode, form);
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    try {
      const session = await api.post<Session>(mode === 'login' ? '/auth/login' : '/auth/signup', mode === 'login' ? { email: form.email, password: form.password } : form);
      qc.setQueryData(keys.session, session);
      navigate(safeNext ?? (session.workspaces.length ? '/' : '/onboarding'), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const isSignup = mode === 'signup';
  const strength = Math.min(4, [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(form.password)).length);

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Brand to="/welcome" />
        <div className="auth-aside-body">
          <h2>{isSignup ? 'Your whole team. Free. Forever.' : 'Welcome back.'}</h2>
          <p>{isSignup ? 'Boards, sprints, timelines, reports, a personal to-do list and a free AI guide — for unlimited users.' : 'Pick up exactly where you left off. Your board is waiting.'}</p>
          <ul>
            <li><Icon name="checkcircle" size={17} /> Set up in under a minute</li>
            <li><Icon name="checkcircle" size={17} /> Invite as many people as you like</li>
            <li><Icon name="checkcircle" size={17} /> Your data stays yours — no ads, no selling</li>
          </ul>
        </div>
        <div className="auth-quote">
          <Icon name="lightbulb" size={16} /> Tip: once you’re in, press <b>⌘K</b> (or <b>Ctrl K</b>) to jump anywhere, and <b>C</b> to create a work item.
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="auth-mobile-brand"><Brand to="/welcome" /></div>
          <h1>{isSignup ? 'Create your account' : 'Sign in to Flowstate'}</h1>
          <p className="page-subtitle">{isSignup ? 'Free for everyone. No credit card required.' : 'Good to see you again.'}</p>

          {error && <div className="form-error" role="alert"><Icon name="flag" size={15} /> {error}</div>}

          {!DEMO && (
            <>
              <GoogleButton available={providers.data?.google} next={safeNext} label={isSignup ? 'Sign up with Google' : 'Continue with Google'} onUnavailable={setError} />
              <div className="auth-divider" role="separator"><span>or {isSignup ? 'sign up' : 'sign in'} with email</span></div>
            </>
          )}

          {isSignup && (
            <label className="form-field">
              <span>Full name</span>
              <input className="text-input" autoComplete="name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Alex Morgan" autoFocus />
            </label>
          )}
          <label className="form-field">
            <span>Work email</span>
            <input className="text-input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" autoFocus={!isSignup} />
          </label>
          <label className="form-field">
            <span>Password</span>
            <div className="input-affix">
              <input className="text-input" type={showPw ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={isSignup ? 8 : 1}
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={isSignup ? 'At least 8 characters' : 'Your password'} />
              <button type="button" className="affix-btn" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}><Icon name="eye" size={16} /></button>
            </div>
            {isSignup && form.password && (
              <div className="pw-meter" aria-label={`Password strength ${strength} of 4`}>
                {[0, 1, 2, 3].map((i) => <i key={i} className={i < strength ? `on s${strength}` : ''} />)}
                <small>{['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength]}</small>
              </div>
            )}
          </label>

          <button className="btn btn-primary btn-block btn-xl" disabled={busy} type="submit">
            {busy ? 'Just a moment…' : isSignup ? 'Create free account' : 'Sign in'} {!busy && <Icon name="right" size={16} />}
          </button>

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New to Flowstate?'}{' '}
            <Link to={`${isSignup ? '/login' : '/signup'}${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{isSignup ? 'Sign in' : 'Create a free account'}</Link>
          </p>
          {isSignup && <p className="auth-legal">By continuing you agree to use Flowstate kindly and lawfully. We never sell your data.</p>}
        </form>
      </main>
    </div>
  );
}
