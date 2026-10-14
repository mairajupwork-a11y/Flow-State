import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { PageHeader, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { Locale, Session, Theme } from '../../lib/types';

const LOCALES: [Locale, string, string][] = [
  ['en-GB', 'United Kingdom', '14 Oct 2026'], ['en-US', 'United States', 'Oct 14, 2026'], ['en-IN', 'India', '14 Oct 2026'],
  ['en-SG', 'Singapore', '14 Oct 2026'], ['en-AU', 'Australia', '14 Oct 2026'],
];

function readPref(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
}
function writePref(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage blocked */ }
}

export default function Settings() {
  const { me, workspace, isAdmin } = useWs();
  const qc = useQueryClient();
  const [theme, setTheme] = useTheme();
  const [profile, setProfile] = useState({ name: me.name, jobTitle: me.jobTitle });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [compact, setCompact] = useState(() => readPref('fs_compact', false));
  const [motion, setMotion] = useState(() => readPref('fs_reduce_motion', false));
  const [wsForm, setWsForm] = useState({ name: workspace.name, locale: workspace.locale, weekStart: workspace.weekStart });

  const saveMe = useMutation({
    mutationFn: (body: object) => api.patch<Session>('/auth/me', body),
    onSuccess: (s) => { qc.setQueryData(keys.session, s); qc.invalidateQueries({ queryKey: ['ws'] }); toast('Saved.'); },
  });
  const savePw = useMutation({ mutationFn: () => api.post('/auth/password', pw), onSuccess: () => { setPw({ current: '', next: '' }); toast('Password updated.'); } });
  const saveWs = useMutation({ mutationFn: () => api.patch(`/workspaces/${workspace.slug}`, wsForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ws'] }); qc.invalidateQueries({ queryKey: keys.session }); toast('Workspace updated.'); } });

  const applyCompact = (v: boolean) => { setCompact(v); writePref('fs_compact', v); document.documentElement.classList.toggle('compact', v); };
  const applyMotion = (v: boolean) => { setMotion(v); writePref('fs_reduce_motion', v); document.documentElement.classList.toggle('reduce-motion', v); };

  return (
    <>
      <PageHeader eyebrow="Workspace / Preferences" title="Make this space yours." subtitle="Simple settings for a calmer way to work." />
      <div className="two-col">
        <div className="stack-16">
          <form className="content-card" onSubmit={(e: FormEvent) => { e.preventDefault(); saveMe.mutate(profile); }}>
            <h3>Profile</h3>
            <p className="muted">How teammates see you</p>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <label className="form-field"><span>Full name</span><input className="text-input" value={profile.name} maxLength={80} required onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
              <label className="form-field"><span>Job title</span><input className="text-input" value={profile.jobTitle} maxLength={80} onChange={(e) => setProfile({ ...profile, jobTitle: e.target.value })} placeholder="e.g. Product designer" /></label>
              <label className="form-field full"><span>Email</span><input className="text-input" value={me.email} disabled /></label>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saveMe.isPending}>Save profile</button>
          </form>

          <div className="content-card">
            <h3>Appearance</h3>
            <div className="setting-row">
              <div><strong>Theme</strong><small>Light, dark, or follow your device.</small></div>
              <div className="tabs">{(['light', 'dark', 'system'] as Theme[]).map((t) => <button key={t} className={`tab ${theme === t ? 'active' : ''}`} aria-pressed={theme === t} onClick={() => { setTheme(t); saveMe.mutate({ theme: t }); }} style={{ textTransform: 'capitalize' }}>{t}</button>)}</div>
            </div>
            <div className="setting-row"><div><strong>Compact cards</strong><small>Show denser work item cards on boards.</small></div><Toggle on={compact} onChange={applyCompact} label="Compact cards" /></div>
            <div className="setting-row"><div><strong>Reduce motion</strong><small>Minimise animations across Flowstate.</small></div><Toggle on={motion} onChange={applyMotion} label="Reduce motion" /></div>
          </div>

          <div className="content-card">
            <h3>Date format</h3>
            <p className="muted">Used for every date you see</p>
            <div className="locale-grid">
              {LOCALES.map(([l, label, sample]) => (
                <button key={l} className={`region-card sm ${me.locale === l ? 'selected' : ''}`} aria-pressed={me.locale === l} onClick={() => saveMe.mutate({ locale: l })}><b>{label}</b><small>{sample}</small></button>
              ))}
            </div>
          </div>
        </div>

        <div className="stack-16">
          {isAdmin && (
            <form className="content-card" onSubmit={(e: FormEvent) => { e.preventDefault(); saveWs.mutate(); }}>
              <h3>Workspace</h3>
              <p className="muted">Settings for everyone in {workspace.name}</p>
              <div className="stack-14" style={{ marginTop: 14 }}>
                <label className="form-field"><span>Workspace name</span><input className="text-input" value={wsForm.name} maxLength={60} onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })} /></label>
                <div className="form-grid">
                  <label className="form-field"><span>Default date format</span>
                    <select className="field-select" value={wsForm.locale} onChange={(e) => setWsForm({ ...wsForm, locale: e.target.value as Locale })}>{LOCALES.map(([l, label]) => <option key={l} value={l}>{label}</option>)}</select>
                  </label>
                  <label className="form-field"><span>Weeks start on</span>
                    <select className="field-select" value={wsForm.weekStart} onChange={(e) => setWsForm({ ...wsForm, weekStart: Number(e.target.value) as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select>
                  </label>
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saveWs.isPending}>Save workspace</button>
            </form>
          )}

          <form className="content-card" onSubmit={(e: FormEvent) => { e.preventDefault(); savePw.mutate(); }}>
            <h3>Security</h3>
            <p className="muted">Change your password</p>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <label className="form-field"><span>Current password</span><input className="text-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
              <label className="form-field"><span>New password</span><input className="text-input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></label>
            </div>
            <button className="btn btn-light" style={{ marginTop: 14 }} disabled={savePw.isPending || pw.next.length < 8}>Update password</button>
          </form>

          <div className="content-card">
            <h3>What Flowstate stands for</h3>
            <p className="muted">Promises built into the product</p>
            <div className="setting-row"><div><strong>No user seat caps</strong><small>Free for unlimited people, every feature included.</small></div><Icon name="checkcircle" size={19} /></div>
            <div className="setting-row"><div><strong>Free AI guidance</strong><small>The Flow guide runs on your workspace data — no paid AI, no limits.</small></div><Icon name="checkcircle" size={19} /></div>
            <div className="setting-row"><div><strong>Simple, familiar workflows</strong><small>Designed for technical and non-technical teams alike.</small></div><Icon name="checkcircle" size={19} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
