import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useWs } from '../../lib/workspace';
import { openCreate } from '../../lib/store';
import { isoDay, todayISO } from '../../lib/format';
import { SectionBar, FilterBar, useProjectCtx } from './ProjectLayout';

export default function CalendarView() {
  const { filtered } = useProjectCtx();
  const { locale, workspace, canEdit } = useWs();
  const [, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const today = todayISO();
  const weekStart = workspace.weekStart;

  const { base, cells } = useMemo(() => {
    const b = new Date();
    b.setDate(1);
    b.setMonth(b.getMonth() + offset);
    const first = (b.getDay() - weekStart + 7) % 7;
    const days = new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate();
    const out = Array.from({ length: Math.ceil((days + first) / 7) * 7 }, (_, i) => {
      const d = new Date(b.getFullYear(), b.getMonth(), i - first + 1);
      return { day: d.getDate(), iso: isoDay(d), out: d.getMonth() !== b.getMonth() };
    });
    return { base: b, cells: out };
  }, [offset, weekStart]);

  const byDay = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    filtered.forEach((i) => i.dueDate && m.set(i.dueDate, [...(m.get(i.dueDate) ?? []), i]));
    return m;
  }, [filtered]);

  const heads = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((i + weekStart) % 7)).toLocaleDateString(locale, { weekday: 'short' }));

  return (
    <>
      <SectionBar title="Due dates" sub="Every deadline, one month at a time" />
      <FilterBar count={filtered.filter((i) => i.dueDate).length} />
      <div className="content-card">
        <div className="section-bar" style={{ marginTop: 0 }}>
          <h3>{base.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h3>
          <div className="row-8">
            <button className="btn btn-light btn-sm" onClick={() => setOffset(offset - 1)} aria-label="Previous month"><Icon name="left" size={16} /></button>
            <button className="btn btn-light btn-sm" onClick={() => setOffset(0)}>Today</button>
            <button className="btn btn-light btn-sm" onClick={() => setOffset(offset + 1)} aria-label="Next month"><Icon name="right" size={16} /></button>
          </div>
        </div>
        <div className="calendar-grid" role="grid">
          {heads.map((d) => <div className="calendar-head" key={d} role="columnheader">{d}</div>)}
          {cells.map((d) => {
            const list = byDay.get(d.iso) ?? [];
            return (
              <div key={d.iso} role="gridcell" className={`calendar-day ${d.out ? 'outside' : ''} ${d.iso === today ? 'today' : ''} ${canEdit ? 'can-add' : ''}`}
                onDoubleClick={() => canEdit && openCreate({ dueDate: d.iso })}>
                <div className="row-between">
                  <span className="day-num">{d.day}</span>
                  {canEdit && <button className="cal-add" onClick={() => openCreate({ dueDate: d.iso })} aria-label={`Create work due ${d.iso}`}><Icon name="plus" size={12} /></button>}
                </div>
                {list.slice(0, 3).map((t) => (
                  <button key={t.id} className={`calendar-chip prio-${t.priority} ${t.statusCategory === 'done' ? 'is-done' : ''}`} onClick={() => setParams({ issue: t.key })} title={`${t.key} ${t.title}`}>{t.title}</button>
                ))}
                {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              </div>
            );
          })}
        </div>
        <p className="hint-line"><Icon name="lightbulb" size={14} /> Tip: double-click a day (or use its +) to create something due then.</p>
      </div>
    </>
  );
}
