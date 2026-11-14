import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, ErrorState, PageHeader, PageLoader } from '../../components/ui';
import { useMyIssues, useTodos, useTodoMutations } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { openGuide } from '../../lib/store';
import { addDays, daysBetween, fmtDate, todayISO } from '../../lib/format';
import type { TimeBlock, Todo } from '../../lib/types';

const BLOCKS: [TimeBlock, string, string][] = [['morning', 'Morning', 'sun'], ['afternoon', 'Afternoon', 'bolt'], ['evening', 'Evening', 'moon'], ['anytime', 'Anytime', 'clock']];
const TIPS = [
  'Choose your three most important outcomes, then give each a realistic place in your day.',
  'Do the hardest thing first, while your energy is highest.',
  'Batch small tasks like emails into one 20-minute slot.',
  'Leave 20% of your day unplanned — surprises always arrive.',
  'Finish one thing before starting the next. Momentum loves focus.',
];

export function MyDay() {
  const { workspace, locale } = useWs();
  const [day, setDay] = useState(todayISO());
  const { data, error, refetch } = useTodos(day);
  const m = useTodoMutations(day);
  const mine = useMyIssues(workspace.slug);
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'All' | 'Active' | 'Completed'>('All');
  const [text, setText] = useState('');
  const [block, setBlock] = useState<TimeBlock>('anytime');
  const [important, setImportant] = useState(false);
  const isToday = day === todayISO();

  const items = useMemo(() => (data?.items ?? []).filter((t) => filter === 'All' || (filter === 'Completed' ? t.done : !t.done)), [data, filter]);
  const pinnedKeys = new Set((data?.items ?? []).map((t) => t.issueKey).filter(Boolean));
  const suggestions = (mine.data ?? []).filter((i) => i.statusCategory !== 'done' && i.dueDate && i.dueDate <= addDays(day, 1) && !pinnedKeys.has(i.key)).slice(0, 4);

  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!data) return <PageLoader />;

  const total = data.items.length;
  const done = data.items.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    m.add.mutate({ text: v, timeBlock: block, important });
    setText('');
    setImportant(false);
  };

  const dateLabel = new Date(day + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const streak = (() => {
    let s = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(todayISO(), -i);
      const h = data.history.find((x) => x.day === d);
      if (h && h.done > 0) s++;
      else if (i > 0) break;
    }
    return s;
  })();

  return (
    <>
      <PageHeader eyebrow="Personal / My day" title="A little more focus. A lot less noise." subtitle="Your private task list with reminders, separate from team project work. Only you can see it." />
      <div className="todo-grid">
        <div className="content-card">
          <div className="section-bar" style={{ marginTop: 0 }}>
            <div><h3>{isToday ? 'Today’s intentions' : dateLabel}</h3><p className="muted">{isToday ? 'One thing at a time. You’ve got this.' : daysBetween(todayISO(), day) > 0 ? 'Planning ahead — nice.' : 'Looking back at a past day.'}</p></div>
            <div className="row-8">
              <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><Icon name="left" size={16} /></button>
              <button className="status-pill as-btn" onClick={() => setDay(todayISO())} title="Back to today">{fmtDate(day, locale)}{isToday ? ' · Today' : ''}</button>
              <button className="icon-btn" onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><Icon name="right" size={16} /></button>
            </div>
          </div>

          <form className="todo-add" onSubmit={submit}>
            <button type="button" className={`icon-btn star ${important ? 'on' : ''}`} onClick={() => setImportant(!important)} aria-pressed={important} aria-label="Mark as important" title="Important"><Icon name="star" size={17} /></button>
            <input className="text-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something on your mind…" autoComplete="off" maxLength={200} aria-label="New to-do" />
            <select className="field-select block-select" value={block} onChange={(e) => setBlock(e.target.value as TimeBlock)} aria-label="Time of day">
              {BLOCKS.map(([b, label]) => <option key={b} value={b}>{label}</option>)}
            </select>
            <button className="btn btn-primary" type="submit"><Icon name="plus" size={16} /> Add</button>
          </form>

          <div className="row-between" style={{ margin: '11px 0 5px' }}>
            <div className="tabs">{(['All', 'Active', 'Completed'] as const).map((x) => <button key={x} className={`tab ${filter === x ? 'active' : ''}`} aria-pressed={filter === x} onClick={() => setFilter(x)}>{x}</button>)}</div>
            {done > 0 && <button className="link-btn" onClick={() => m.clear.mutate()}>Clear completed</button>}
          </div>

          {BLOCKS.map(([b, label, icon]) => {
            const list = items.filter((t) => t.timeBlock === b);
            if (!list.length) return null;
            return (
              <div key={b} className="todo-block">
                <div className="todo-block-head"><Icon name={icon} size={14} /> {label} <span className="col-count">{list.length}</span></div>
                {list.map((t) => <TodoRow key={t.id} todo={t} day={day} onToggle={(v) => m.update.mutate({ id: t.id, patch: { done: v } })} onStar={() => m.update.mutate({ id: t.id, patch: { important: !t.important } })}
                  onMove={(tb) => m.update.mutate({ id: t.id, patch: { timeBlock: tb } })} onTomorrow={() => m.update.mutate({ id: t.id, patch: { day: addDays(todayISO(), 1) } })}
                  onRemind={(remindAt) => m.update.mutate({ id: t.id, patch: { remindAt, reminded: false } })}
                  onRemove={() => m.remove.mutate(t.id)} onOpenIssue={() => t.issueKey && setParams({ issue: t.issueKey })} />)}
              </div>
            );
          })}
          {!items.length && <Empty icon="checkcircle" title={filter === 'Completed' ? 'Nothing finished yet' : 'All clear.'}>{filter === 'Completed' ? 'Tick something off — it feels great.' : 'Enjoy the extra breathing room, or add your first intention above.'}</Empty>}
        </div>

        <div className="stack-16">
          <div className="content-card">
            <h3>Your daily momentum</h3>
            <p className="muted">Small steps are still progress.</p>
            <div className="progress-ring" style={{ ['--p' as string]: `${pct}%` }} role="img" aria-label={`${pct}% of today’s to-dos complete`}><strong>{pct}%</strong><small>completed</small></div>
            <div className="ring-text"><strong>{done} of {total} tasks completed</strong><p>{done === total && total ? 'Brilliant. You cleared your list. 🎉' : 'Keep your list gentle and achievable.'}</p></div>
            <div className="week-bars" aria-label="Last seven days">
              {Array.from({ length: 7 }, (_, i) => addDays(day, i - 6)).map((d) => {
                const h = data.history.find((x) => x.day === d);
                const r = h && h.total ? h.done / h.total : 0;
                return <div key={d} title={`${fmtDate(d, locale)}: ${h?.done ?? 0}/${h?.total ?? 0}`}><span style={{ height: `${Math.max(6, r * 100)}%`, opacity: h ? 1 : 0.35 }} /><small>{new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'narrow' })}</small></div>;
              })}
            </div>
            {streak > 1 && <p className="streak"><Icon name="bolt" size={14} /> {streak}-day streak — lovely consistency.</p>}
          </div>

          {suggestions.length > 0 && isToday && (
            <div className="content-card">
              <h3>From your projects</h3>
              <p className="muted">Assigned to you and due soon — pin to today?</p>
              {suggestions.map((i) => (
                <div className="suggest-row" key={i.id}>
                  <span><b>{i.title}</b><small>{i.key} · due {fmtDate(i.dueDate, locale)}</small></span>
                  <button className="btn btn-soft btn-sm" onClick={() => m.add.mutate({ text: i.title, issueRef: i.key, timeBlock: 'morning', important: i.priority === 'urgent' || i.priority === 'high' })}><Icon name="plus" size={13} /> Pin</button>
                </div>
              ))}
            </div>
          )}

          <div className="tip-box"><Icon name="lightbulb" size={19} /><span><b>Focus tip:</b> {TIPS[new Date(day).getDate() % TIPS.length]}</span></div>
          <button className="btn btn-light btn-block" onClick={() => openGuide('Prioritise my day')}><Icon name="sparkles" size={16} /> Help me plan my day</button>
        </div>
      </div>
    </>
  );
}

/** "2026-11-14T09:30" in the browser's own time zone, for a datetime-local input. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const at = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };

/** Reminder for one personal to-do: quick picks or an exact time. Sent in the app, and by push/email if turned on in Settings. */
function ReminderMenu({ todo, onRemind }: { todo: Todo; onRemind: (iso: string | null) => void }) {
  const { locale } = useWs();
  const [custom, setCustom] = useState(() => localInput(todo.remindAt ? new Date(todo.remindAt) : at(0, new Date().getHours() + 1)));
  const close = (el: HTMLElement) => { (el.closest('details') as HTMLDetailsElement).open = false; };
  const pick = (el: HTMLElement, d: Date | null) => { close(el); onRemind(d ? d.toISOString() : null); };
  const when = todo.remindAt ? new Date(todo.remindAt) : null;
  const label = when ? when.toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const later = new Date(Date.now() + 60 * 60_000);
  return (
    <details className="row-menu remind">
      <summary className={`icon-btn tiny bell ${when ? (todo.reminded ? 'sent' : 'on') : ''}`} aria-label={when ? `Reminder ${label}` : 'Set a reminder'} title={when ? `${todo.reminded ? 'Reminded' : 'Reminder'}: ${label}` : 'Remind me'}>
        <Icon name="bell" size={15} />{when && <span className="remind-time">{label}</span>}
      </summary>
      <div className="menu remind-menu">
        <div className="menu-title">Remind me</div>
        <button className="menu-item" onClick={(e) => pick(e.currentTarget, later)}><Icon name="clock" size={14} /> In 1 hour</button>
        {new Date().getHours() < 17 && <button className="menu-item" onClick={(e) => pick(e.currentTarget, at(0, 17))}><Icon name="sun" size={14} /> This evening (5 pm)</button>}
        <button className="menu-item" onClick={(e) => pick(e.currentTarget, at(1, 9))}><Icon name="right" size={14} /> Tomorrow morning (9 am)</button>
        <button className="menu-item" onClick={(e) => pick(e.currentTarget, at(((8 - new Date().getDay()) % 7) || 7, 9))}><Icon name="calendar" size={14} /> Next Monday (9 am)</button>
        <div className="menu-sep" />
        <form className="remind-custom" onSubmit={(e) => { e.preventDefault(); const d = new Date(custom); if (!Number.isNaN(d.getTime())) pick(e.currentTarget, d); }}>
          <input type="datetime-local" className="text-input slim" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Reminder date and time" />
          <button className="btn btn-primary btn-sm">Set</button>
        </form>
        {when && <><div className="menu-sep" /><button className="menu-item danger" onClick={(e) => pick(e.currentTarget, null)}><Icon name="close" size={14} /> Remove reminder</button></>}
        <p className="menu-hint">You’ll get it in WorkMars, and on your phone or email if notifications are on in Settings.</p>
      </div>
    </details>
  );
}

function TodoRow({ todo, day, onToggle, onStar, onMove, onTomorrow, onRemind, onRemove, onOpenIssue }: {
  todo: Todo; day: string; onToggle: (v: boolean) => void; onStar: () => void; onMove: (b: TimeBlock) => void; onTomorrow: () => void; onRemind: (iso: string | null) => void; onRemove: () => void; onOpenIssue: () => void;
}) {
  const rolled = !todo.done && todo.day < day;
  // Local mirror so the tick responds instantly, before the optimistic cache write lands.
  const [checked, setChecked] = useState(todo.done);
  useEffect(() => setChecked(todo.done), [todo.done]);
  return (
    <div className="todo-item">
      <input className="todo-check" type="checkbox" checked={checked} onChange={(e) => { setChecked(e.target.checked); onToggle(e.target.checked); }} aria-label={`Mark ${todo.text} ${todo.done ? 'incomplete' : 'complete'}`} />
      <div className={`todo-copy ${todo.done ? 'completed' : ''}`}>
        <strong>{todo.text}</strong>
        <small>
          {todo.done ? 'Nicely done' : rolled ? 'Carried over from an earlier day' : 'Personal task · just for you'}
          {todo.issueKey && <> · <button className="link-btn" onClick={onOpenIssue}>{todo.issueKey}</button></>}
        </small>
      </div>
      {!todo.done && <ReminderMenu todo={todo} onRemind={onRemind} />}
      <button className={`icon-btn tiny star ${todo.important ? 'on' : ''}`} onClick={onStar} aria-pressed={todo.important} aria-label="Important"><Icon name="star" size={15} /></button>
      <details className="row-menu">
        <summary className="icon-btn tiny" aria-label="More options"><Icon name="ellipsis" size={15} /></summary>
        <div className="menu">
          {BLOCKS.filter(([b]) => b !== todo.timeBlock).map(([b, label, icon]) => <button key={b} className="menu-item" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; onMove(b); }}><Icon name={icon} size={14} /> Move to {label.toLowerCase()}</button>)}
          {!todo.done && <button className="menu-item" onClick={onTomorrow}><Icon name="right" size={14} /> Do it tomorrow</button>}
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={onRemove}><Icon name="trash" size={14} /> Remove</button>
        </div>
      </details>
    </div>
  );
}
