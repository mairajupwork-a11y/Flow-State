import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { api } from '../../lib/api';
import { askConfirm, copyText, toast, toastError } from '../../lib/store';
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '../../lib/push';
import type { NotifyPref, NotifySettings } from '../../lib/types';

const PREFS: [NotifyPref, string, string][] = [
  ['important', 'Important', 'Mentions, assignments and automations'],
  ['all', 'Everything', 'Also comments and status changes on work you watch'],
  ['off', 'Off', 'Only the bell inside WorkMars'],
];

const useNotifySettings = () => useQuery({ queryKey: ['notify-settings'], queryFn: () => api.get<NotifySettings>('/settings/notifications') });

function PrefPicker({ value, onChange, label, disabled }: { value: NotifyPref; onChange: (v: NotifyPref) => void; label: string; disabled?: boolean }) {
  return (
    <div className="pref-picker" role="radiogroup" aria-label={label}>
      {PREFS.map(([k, name, hint]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} disabled={disabled} className={`pref-option ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>
          <b>{name}</b><small>{hint}</small>
        </button>
      ))}
    </div>
  );
}

/** Email + push preferences and turning on push for this device. */
export function NotificationsCard() {
  const qc = useQueryClient();
  const settings = useNotifySettings();
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { currentSubscription().then((s) => setDeviceOn(!!s)).catch(() => setDeviceOn(false)); }, []);
  const save = useMutation({
    mutationFn: (body: Partial<Pick<NotifySettings, 'email' | 'push'>>) => api.patch('/settings/notifications', body),
    onMutate: (body) => qc.setQueryData<NotifySettings>(['notify-settings'], (s) => s && { ...s, ...body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notify-settings'] }),
  });
  const s = settings.data;

  async function toggleDevice() {
    if (!s?.pushKey) return;
    setBusy(true);
    try {
      if (deviceOn) { await disablePush(); setDeviceOn(false); toast('Push notifications are off on this device.'); }
      else { await enablePush(s.pushKey); setDeviceOn(true); toast('Push notifications are on for this device.'); }
      qc.invalidateQueries({ queryKey: ['notify-settings'] });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }
  const test = useMutation({ mutationFn: () => api.post<{ sent: number }>('/push/test'), onSuccess: (r) => toast(r.sent ? 'Test sent — check your notifications.' : 'No device received it. Turn notifications on again.') });

  const iosHint = isIos() && !isStandalone();
  return (
    <div className="content-card">
      <h3><Icon name="bell" size={16} /> Notifications</h3>
      <p className="muted">Choose what reaches you outside WorkMars. The bell inside the app always shows everything.</p>

      <div className="notify-block">
        <div className="notify-head"><Icon name="mail" size={15} /><strong>Email</strong>{s && !s.emailAvailable && <span className="soft-chip">Not set up on this server</span>}</div>
        {s && !s.emailAvailable && <p className="tiny-note">Your WorkMars admin needs to add an email account (see EMAIL.md) before emails can be sent.</p>}
        <PrefPicker label="Email notifications" value={s?.email ?? 'important'} disabled={!s?.emailAvailable} onChange={(email) => save.mutate({ email })} />
      </div>

      <div className="notify-block">
        <div className="notify-head"><Icon name="phone" size={15} /><strong>Push to this device</strong>
          {deviceOn && <span className="soft-chip ok">On here</span>}
          {s && s.devices > 0 && <span className="tiny-note">{s.devices} device{s.devices === 1 ? '' : 's'} in total</span>}
        </div>
        {iosHint
          ? <p className="tiny-note">On iPhone or iPad: tap <b>Share</b> → <b>Add to Home Screen</b>, open WorkMars from your Home Screen, then come back here to turn notifications on.</p>
          : !pushSupported() ? <p className="tiny-note">This browser doesn’t support push notifications. Try Chrome, Edge, Firefox or Safari.</p>
          : !window.isSecureContext ? <p className="tiny-note">Push needs a secure address (https). It will work once WorkMars is online with https.</p>
          : null}
        <div className="row-8 wrap" style={{ margin: '4px 0 10px' }}>
          <button className="btn btn-soft btn-sm" disabled={busy || !s?.pushAvailable || !pushSupported() || deviceOn === null} onClick={toggleDevice}>
            <Icon name="bell" size={13} /> {deviceOn ? 'Turn off on this device' : 'Turn on for this device'}
          </button>
          {deviceOn && <button className="btn btn-light btn-sm" disabled={test.isPending} onClick={() => test.mutate()}>Send a test</button>}
        </div>
        <PrefPicker label="Push notifications" value={s?.push ?? 'important'} onChange={(push) => save.mutate({ push })} />
      </div>
    </div>
  );
}

/** Private calendar feed: subscribe once from Google Calendar (or Outlook / Apple) and due dates stay in sync. */
export function CalendarCard() {
  const qc = useQueryClient();
  const settings = useNotifySettings();
  const make = useMutation({ mutationFn: () => api.post<{ calendarUrl: string; calendarReachable: boolean }>('/calendar/token'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notify-settings'] }) });
  const stop = useMutation({ mutationFn: () => api.del('/calendar/token'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['notify-settings'] }); toast('Calendar link turned off.'); } });
  const s = settings.data;
  const url = s?.calendarUrl;
  const google = url ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}` : null;

  return (
    <div className="content-card">
      <h3><Icon name="calendar" size={16} /> Google Calendar</h3>
      <p className="muted">See everything assigned to you, by due date, in Google Calendar — it updates by itself as work changes.</p>
      {!url ? (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={make.isPending} onClick={() => make.mutate()}><Icon name="calendar" size={13} /> Connect my calendar</button>
      ) : (
        <div className="stack-8" style={{ marginTop: 12 }}>
          {!s?.calendarReachable && (
            <div className="form-note"><Icon name="lightbulb" size={15} /> Google can only read this link once WorkMars is online at a public address. While it runs on your computer, use “Add to Google Calendar” on individual work items instead.</div>
          )}
          <div className="row-8 wrap">
            <a className="btn btn-primary btn-sm" href={google!} target="_blank" rel="noopener noreferrer"><Icon name="calendar" size={13} /> Add to Google Calendar</a>
            <button className="btn btn-light btn-sm" onClick={() => copyText(url, 'Calendar link copied. Paste it into Outlook or Apple Calendar → “Subscribe”.')}><Icon name="copy" size={13} /> Copy link</button>
          </div>
          <div className="mono-box" title="Keep this private: anyone with it can see your due dates">{url}</div>
          <p className="tiny-note">Keep this link private. Google refreshes subscribed calendars every few hours. Outlook and Apple Calendar: use “Subscribe from web / URL”.</p>
          <div className="row-8 wrap">
            <button className="link-btn" onClick={async () => (await askConfirm({ title: 'Make a new link?', body: 'The old link stops working. You’ll need to add the new one to your calendar.', confirmLabel: 'New link' })) && make.mutate()}>Make a new link</button>
            <button className="link-btn" onClick={async () => (await askConfirm({ title: 'Turn off the calendar link?', body: 'Calendars using it will stop updating.', confirmLabel: 'Turn off', danger: true })) && stop.mutate()}>Turn off</button>
          </div>
        </div>
      )}
    </div>
  );
}
