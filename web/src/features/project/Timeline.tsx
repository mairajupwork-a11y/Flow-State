import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, TypeIcon } from '../../components/ui';
import { useWs } from '../../lib/workspace';
import { addDays, daysBetween, fmtDate, todayISO } from '../../lib/format';
import type { Issue } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

const DAY_W = 28;
const SPAN = 42; // six weeks visible

/** Roadmap: epics with their children, then other dated work. Bars span start → due. */
export default function Timeline() {
  const { filtered, issues } = useProjectCtx();
  const { locale, workspace } = useWs();
  const [, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const today = todayISO();
  const weekStart = workspace.weekStart;
  const start = useMemo(() => {
    const anchor = addDays(today, offset * 7 - 7);
    const shift = (new Date(anchor + 'T12:00:00').getDay() - weekStart + 7) % 7;
    return addDays(anchor, -shift);
  }, [today, offset, weekStart]);
  const days = Array.from({ length: SPAN }, (_, i) => addDays(start, i));

  const groups = useMemo(() => {
    const dated = (i: Issue) => i.dueDate || i.startDate;
    const epics = filtered.filter((i) => i.type === 'epic');
    const result: { epic: Issue | null; items: Issue[] }[] = epics.map((e) => ({ epic: e, items: filtered.filter((i) => i.epicId === e.id && dated(i)) }));
    const loose = filtered.filter((i) => i.type !== 'epic' && i.type !== 'subtask' && dated(i) && !epics.some((e) => e.id === i.epicId));
    if (loose.length) result.push({ epic: null, items: loose });
    return result;
  }, [filtered]);

  const bar = (i: Issue) => {
    const s = i.startDate ?? addDays(i.dueDate!, -2);
    const e = i.dueDate ?? addDays(s, 2);
    const from = Math.max(0, daysBetween(start, s));
    const to = Math.min(SPAN - 1, daysBetween(start, e));
    if (to < 0 || from > SPAN - 1) return null;
    return { left: from * DAY_W, width: Math.max(DAY_W, (to - from + 1) * DAY_W), clippedL: daysBetween(start, s) < 0, clippedR: daysBetween(start, e) > SPAN - 1 };
  };
  const epicRange = (epic: Issue, items: Issue[]): Issue => {
    const dates = items.flatMap((i) => [i.startDate, i.dueDate]).filter(Boolean) as string[];
    if (epic.startDate || epic.dueDate || !dates.length) return epic;
    return { ...epic, startDate: dates.sort()[0], dueDate: dates.sort().at(-1)! };
  };
  const open = (key: string) => setParams({ issue: key });
  const todayX = daysBetween(start, today) * DAY_W + DAY_W / 2;

  return (
    <>
      <SectionBar title="Delivery roadmap" sub="Work with dates, grouped by epic" />
      <div className="content-card">
        <div className="timeline-head">
          <div><h3>{fmtDate(days[0], locale)} – {fmtDate(days[SPAN - 1], locale, true)}</h3><p className="muted">Bars run from start date to due date. Click any bar to adjust it.</p></div>
          <div className="row-8">
            <button className="btn btn-light btn-sm" onClick={() => setOffset(offset - 2)} aria-label="Earlier"><Icon name="left" size={16} /></button>
            <button className="btn btn-light btn-sm" onClick={() => setOffset(0)}>Today</button>
            <button className="btn btn-light btn-sm" onClick={() => setOffset(offset + 2)} aria-label="Later"><Icon name="right" size={16} /></button>
          </div>
        </div>
        {groups.every((g) => !g.items.length && !g.epic) ? (
          <Empty icon="timeline" title="Nothing on the roadmap yet">Add start and due dates to work items (or create an epic) and they’ll appear here.</Empty>
        ) : (
          <div className="timeline-scroll">
            <div className="tl" style={{ width: `calc(var(--tl-label) + ${SPAN * DAY_W}px)` }}>
              <div className="tl-header">
                <div className="tl-label tl-th">Work</div>
                <div className="tl-days">
                  {days.map((d) => {
                    const dt = new Date(d + 'T12:00:00');
                    const first = dt.getDay() === weekStart;
                    return <div key={d} className={`tl-day ${d === today ? 'today' : ''} ${dt.getDay() % 6 === 0 ? 'weekend' : ''}`} style={{ width: DAY_W }}>{first && <span className="tl-week">{fmtDate(d, locale)}</span>}<span>{dt.toLocaleDateString(locale, { weekday: 'narrow' })}</span></div>;
                  })}
                </div>
              </div>
              <div className="tl-body">
                {todayX > 0 && todayX < SPAN * DAY_W && <div className="tl-today" style={{ left: `calc(var(--tl-label) + ${todayX}px)` }} aria-hidden="true" />}
                {groups.map(({ epic, items }) => {
                  const e = epic ? epicRange(epic, items) : null;
                  const eb = e ? bar(e) : null;
                  const done = items.filter((i) => i.statusCategory === 'done').length;
                  return (
                    <div key={epic?.id ?? 'loose'} className="tl-group">
                      <div className="tl-row tl-epic">
                        <button className="tl-label" onClick={() => epic && open(epic.key)} disabled={!epic}>
                          {epic ? <><TypeIcon type="epic" size={12} /><b className="ellipsis">{epic.title}</b><small>{done}/{items.length}</small></> : <b>Other dated work</b>}
                        </button>
                        <div className="tl-track">
                          {eb && e && <button className="gantt-bar epic-bar" style={{ left: eb.left, width: eb.width }} onClick={() => open(e.key)} title={`${e.key}: ${fmtDate(e.startDate, locale)} – ${fmtDate(e.dueDate, locale)}`}>
                            <span className="epic-fill" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />{e.key}
                          </button>}
                        </div>
                      </div>
                      {items.map((i) => {
                        const b = bar(i);
                        const tone = i.statusCategory === 'done' ? 'done' : i.statusCategory === 'progress' ? 'progress' : 'todo';
                        return (
                          <div className="tl-row" key={i.id}>
                            <button className="tl-label child" onClick={() => open(i.key)}><TypeIcon type={i.type} size={11} /><span className="ellipsis">{i.title}</span></button>
                            <div className="tl-track">
                              {b && <button className={`gantt-bar tone-${tone} ${b.clippedL ? 'clip-l' : ''} ${b.clippedR ? 'clip-r' : ''}`} style={{ left: b.left, width: b.width }} onClick={() => open(i.key)}
                                title={`${i.key} ${i.title}: ${fmtDate(i.startDate, locale)} – ${fmtDate(i.dueDate, locale)}`}>{i.key}</button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <p className="hint-line"><Icon name="lightbulb" size={14} /> {issues.filter((i) => i.type !== 'epic' && !i.dueDate && !i.startDate).length} work items have no dates yet — set them in each item’s details.</p>
      </div>
    </>
  );
}
