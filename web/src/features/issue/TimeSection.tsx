import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/ui';
import { useWs } from '../../lib/workspace';
import { fmtClock, fmtMinutes, parseDuration, useElapsed, useIssueTime, useRunningTimer, useTimeActions } from '../../lib/time';
import { askConfirm, toast } from '../../lib/store';
import { fmtDate, todayISO } from '../../lib/format';

const QUICK = [15, 30, 60, 120];

/** Time on one work item: a start/stop timer, a quick "log time" line and the entries so far. */
export function TimeSection({ issueKey, canLog }: { issueKey: string; canLog: boolean }) {
  const { me, member, canEdit, locale } = useWs();
  const { data } = useIssueTime(issueKey);
  const { data: running } = useRunningTimer();
  const actions = useTimeActions();
  const mine = running?.issueKey === issueKey ? running : null;
  const elapsed = useElapsed(mine?.startedAt);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(todayISO());
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const minutes = parseDuration(amount);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!minutes) return;
    // Logged against the chosen day (at midday, so time zones never move it to another date).
    const startedAt = day === todayISO() ? undefined : new Date(`${day}T12:00:00`).toISOString();
    actions.log.mutate({ ref: issueKey, body: { minutes, startedAt, note: note.trim(), billable } }, {
      onSuccess: () => { toast(`${fmtMinutes(minutes)} logged.`); setAmount(''); setNote(''); setOpen(false); },
    });
  }

  const entries = data?.entries ?? [];
  return (
    <div className="detail-section time-section">
      <div className="row-between">
        <h4><Icon name="clock" size={14} /> Time {data && data.totalMinutes > 0 && <span className="muted-inline">· {fmtMinutes(data.totalMinutes)} logged</span>}</h4>
        {canLog && (
          <div className="row-8">
            {mine
              ? <button className="btn btn-primary btn-sm timer-btn running" onClick={() => actions.stop.mutate()}><span className="rec" /> {fmtClock(elapsed)} · Stop</button>
              : <button className="btn btn-soft btn-sm timer-btn" onClick={() => actions.start.mutate(issueKey, { onSuccess: () => toast(running ? `Switched the timer to ${issueKey}.` : 'Timer started.') })}><Icon name="play" size={12} /> Start timer</button>}
            <button className="link-btn" onClick={() => setOpen((o) => !o)}><Icon name="plus" size={13} /> Log time</button>
          </div>
        )}
      </div>

      {open && canLog && (
        <form className="time-form" onSubmit={submit}>
          <div className="time-quick">
            {QUICK.map((q) => <button type="button" key={q} className={`chip-option ${minutes === q ? 'on' : ''}`} onClick={() => setAmount(fmtMinutes(q))}>{fmtMinutes(q)}</button>)}
          </div>
          <div className="time-row">
            <input className="text-input" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1h 30m" aria-label="How long" aria-invalid={!!amount && !minutes} />
            <input className="text-input" type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value || todayISO())} aria-label="Day" />
          </div>
          <input className="text-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on? (optional)" aria-label="Note" />
          <div className="row-between">
            <label className="check-row" style={{ margin: 0 }}><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable to the client</label>
            <div className="row-8">
              <button type="button" className="btn btn-light btn-sm" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={!minutes || actions.log.isPending}>Log {minutes ? fmtMinutes(minutes) : 'time'}</button>
            </div>
          </div>
          {amount && !minutes && <small className="field-hint bad">Try “1h 30m”, “45m”, “1.5” or “1:30”.</small>}
        </form>
      )}

      {entries.length > 0 && (
        <ul className="time-list">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id}>
              <Avatar user={member(e.userId) ?? { name: e.userName, initials: e.userName.slice(0, 2).toUpperCase(), color: e.userColor }} size="sm" />
              <span className="time-copy"><b>{e.running ? 'Running…' : fmtMinutes(e.minutes)}</b>{e.note && <span> · {e.note}</span>}<small>{e.userName} · {fmtDate(e.startedAt.slice(0, 10), locale)}{!e.billable && ' · non-billable'}</small></span>
              {(e.userId === me.id || canEdit) && !e.running && (
                <button className="icon-btn tiny reveal" aria-label="Delete this time entry" onClick={async () => (await askConfirm({ title: 'Delete this time entry?', body: `${fmtMinutes(e.minutes)} by ${e.userName}.`, confirmLabel: 'Delete', danger: true })) && actions.remove.mutate(e.id)}><Icon name="trash" size={13} /></button>
              )}
            </li>
          ))}
          {entries.length > 8 && <li className="tiny-note">+{entries.length - 8} more in Timesheets</li>}
        </ul>
      )}
      {!entries.length && !open && <p className="placeholder small">No time logged yet{canLog ? ' — start the timer or log time when you’re done.' : '.'}</p>}
    </div>
  );
}
