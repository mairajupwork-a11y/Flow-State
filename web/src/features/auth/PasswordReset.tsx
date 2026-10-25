import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import type { Session } from '../../lib/types';
import { Brand } from './Welcome';

function Frame({ title, subtitle, children }: { title: ReactNode; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside has-photo">
        <div className="auth-photo" aria-hidden="true" />
        <div className="auth-brand">
          <Brand to="/welcome" onDark height={34} />
          <span className="brand-tagline">Build <i>/</i> Automate <i>/</i> Grow</span>
        </div>
        <div className="auth-aside-body">
          <h2>Back in <span className="serif-accent">no time.</span></h2>
          <p>We’ll email you a secure, one-time link. It works for an hour and signs you out everywhere else once used.</p>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand"><Brand to="/welcome" /></div>
          <h1>{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Step 1: ask for the email address and send the reset link. */
export function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  const recovery = useQuery({ queryKey: ['recovery'], queryFn: () => api.get<{ email: boolean }>('/auth/recovery'), staleTime: 300_000 });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('That email address doesn’t look right — please check it.');
    setError('');
    setState('busy');
    try {
      await api.post('/auth/forgot', { email: email.trim() });
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <Frame title={<>Check your <span className="serif-accent">inbox</span></>} subtitle="If an account uses that address, a reset link is on its way.">
        <div className="reset-sent">
          <span className="reset-icon"><Icon name="checkcircle" size={22} /></span>
          <p>We sent a link to <b>{email.trim()}</b>. It works once and expires in 60 minutes. Can’t see it? Check spam or promotions, or try again in a minute.</p>
        </div>
        <button type="button" className="btn btn-light btn-block" onClick={() => setState('idle')}>Use a different email</button>
        <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
      </Frame>
    );
  }

  return (
    <Frame title="Reset your password" subtitle="Enter the email you sign in with and we’ll send you a link.">
      <form onSubmit={submit} noValidate>
        {recovery.data && !recovery.data.email && (
          <div className="form-note" role="note"><Icon name="lightbulb" size={15} /> Reset emails aren’t set up on this WorkMars yet. Ask your admin to add an email account (EMAIL.md), or use <b>Continue with Google</b> on the sign-in page.</div>
        )}
        {error && <div className="form-error" role="alert"><Icon name="flag" size={15} /> {error}</div>}
        <label className="form-field">
          <span>Email</span>
          <input className="text-input" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }} placeholder="you@company.com" />
        </label>
        <button className="btn btn-primary btn-block btn-xl" type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? 'Sending…' : 'Send reset link'} {state !== 'busy' && <Icon name="right" size={16} />}
        </button>
        <p className="auth-switch">Remembered it? <Link to="/login">Back to sign in</Link></p>
      </form>
    </Frame>
  );
}

/** Step 2: the emailed link lands here to choose a new password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const check = useQuery({ queryKey: ['reset', token], queryFn: () => api.get<{ email: string }>(`/auth/reset/${encodeURIComponent(token)}`), enabled: token.length > 10, retry: false, staleTime: Infinity });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Your new password needs at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setError('');
    setBusy(true);
    try {
      const session = await api.post<Session>('/auth/reset', { token, password });
      qc.setQueryData(keys.session, session);
      navigate(session.workspaces.length ? '/' : '/onboarding', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  if (!token || check.isError) {
    return (
      <Frame title="This link has expired" subtitle="Reset links work once and only for an hour.">
        <div className="form-error" role="alert"><Icon name="flag" size={15} /> {check.error instanceof Error ? check.error.message : 'The link is incomplete.'}</div>
        <Link className="btn btn-primary btn-block btn-xl" to="/forgot-password">Send me a new link <Icon name="right" size={16} /></Link>
        <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
      </Frame>
    );
  }

  const strength = Math.min(4, [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length);
  return (
    <Frame title={<>Choose a new <span className="serif-accent">password</span></>} subtitle={check.data ? `For ${check.data.email}` : 'Checking your link…'}>
      <form onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert"><Icon name="flag" size={15} /> {error}</div>}
        <input type="email" autoComplete="username" value={check.data?.email ?? ''} readOnly hidden />
        <label className="form-field">
          <span>New password</span>
          <div className="input-affix">
            <input className="text-input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            <button type="button" className="affix-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name="eye" size={16} /></button>
          </div>
          {password && (
            <div className="pw-meter" aria-label={`Password strength ${strength} of 4`}>
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < strength ? `on s${strength}` : ''} />)}
              <small>{['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength]}</small>
            </div>
          )}
        </label>
        <label className="form-field">
          <span>Confirm new password</span>
          <input className="text-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" />
        </label>
        <button className="btn btn-primary btn-block btn-xl" type="submit" disabled={busy || !check.data}>
          {busy ? 'Saving…' : 'Save and sign in'} {!busy && <Icon name="right" size={16} />}
        </button>
      </form>
    </Frame>
  );
}
