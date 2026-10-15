import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { askConfirm, openCreate, toast } from '../../lib/store';
import { daysBetween, fmtDate, todayISO } from '../../lib/format';
import { gateWord, methodologyOf, term, typeLabel, lower } from '../../lib/methodology';
import type { Issue, Phase, PhaseState } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

const STATE_LABEL: Record<PhaseState, string> = { pending: 'Not started', active: 'In progress', review: 'Awaiting approval', complete: 'Approved' };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Predictive lifecycle view (Waterfall phases, PRINCE2 stages, Six Sigma
 * DMAIC). Phases run strictly in order and each ends at a gate: the team
 * submits it for review and an approver records a decision.
 */
export default function Phases() {
  const { project, issues } = useProjectCtx();
  const m = methodologyOf(project);
  const { canEdit, isAdmin, member, locale } = useWs();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const phases = project.phases;
  const current = phases.find((p) => p.state === 'active' || p.state === 'review') ?? phases.find((p) => p.state === 'pending') ?? phases[phases.length - 1];
  const focus = phases.find((p) => p.id === selected) ?? current;
  const gate = gateWord(m);

  const transition = useMutation({
    mutationFn: ({ phase, action, decision }: { phase: Phase; action: string; decision?: string }) =>
      api.post<Phase[]>(`/projects/${project.id}/phases/${phase.id}/transition`, { action, decision }),
    onSuccess: (_d, v) => {
      invalidateWork(qc);
      const msg: Record<string, string> = {
        start: `${v.phase.name} started.`, submit: `${v.phase.name} submitted for ${gate} review.`,
        approve: `${v.phase.name} approved.`, reject: `${v.phase.name} sent back for rework.`, reopen: `${v.phase.name} reopened.`,
      };
      toast(msg[v.action]);
    },
  });
  const edit = useMutation({ mutationFn: ({ phase, body }: { phase: Phase; body: object }) => api.patch(`/projects/${project.id}/phases/${phase.id}`, body), onSuccess: () => invalidateWork(qc) });

  if (!phases.length) {
    return <><SectionBar title={term(m.id, 'phases')} /><Empty icon="layers" title={`No ${lower(term(m.id, 'phases'))} yet`}>This project has no lifecycle defined.</Empty></>;
  }

  const completed = phases.filter((p) => p.state === 'complete').length;
  const decided = phases.filter((p) => p.state === 'complete' || p.decision);
  return (
    <>
      <SectionBar title={`${term(m.id, 'phases')} & ${gate}s`} sub={`${m.name} · ${completed} of ${phases.length} ${gate}s passed`} />

      <ol className="phase-stepper" aria-label={`${term(m.id, 'phases')} in order`}>
        {phases.map((p, i) => {
          const items = issues.filter((x) => x.phaseId === p.id && x.type !== 'epic');
          const done = items.filter((x) => x.statusCategory === 'done').length;
          return (
            <li key={p.id} className={`phase-step ${p.state} ${focus?.id === p.id ? 'focused' : ''}`}>
              <button type="button" onClick={() => setSelected(p.id)} aria-current={focus?.id === p.id ? 'step' : undefined}>
                <span className="phase-dot">{p.state === 'complete' ? <Icon name="check" size={14} /> : p.state === 'pending' ? <Icon name="lock" size={12} /> : i + 1}</span>
                <span className="phase-step-text">
                  <strong>{p.name}</strong>
                  <small>{STATE_LABEL[p.state]}{items.length ? ` · ${done}/${items.length}` : ''}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {focus && (
        <PhaseDetail key={focus.id} phase={focus} index={phases.indexOf(focus)} total={phases.length}
          items={issues.filter((x) => x.phaseId === focus.id && !x.parentId)}
          prevComplete={phases.slice(0, phases.indexOf(focus)).every((p) => p.state === 'complete')}
          canEdit={canEdit} isAdmin={isAdmin} busy={transition.isPending}
          onAction={(action, decision) => transition.mutate({ phase: focus, action, decision })}
          onEdit={(body) => edit.mutate({ phase: focus, body })} />
      )}

      <div className="two-col" style={{ marginTop: 16 }}>
        <div className="content-card">
          <h3>{cap(gate)} log</h3>
          <p className="muted">Every decision, who made it and when — your audit trail.</p>
          <div className="gate-log">
            {decided.map((p) => (
              <div key={p.id} className="gate-log-row">
                <span className={`gate-badge ${p.state}`}><Icon name={p.state === 'complete' ? 'checkcircle' : 'refresh'} size={14} /></span>
                <div>
                  <strong>{p.name}</strong>
                  <p>{p.decision || '—'}</p>
                  <small>{p.completedAt ? `Approved ${fmtDate(p.completedAt, locale, true)}` : 'Returned for rework'}{p.approvedBy ? ` by ${member(p.approvedBy)?.name ?? 'a former member'}` : ''}</small>
                </div>
              </div>
            ))}
            {!decided.length && <p className="muted">No {gate} decisions yet.</p>}
          </div>
        </div>
        <div className="content-card">
          <h3>How {m.name} runs</h3>
          <p className="muted">{m.description}</p>
          <ul className="ceremony-list">
            {m.ceremonies.map((c) => <li key={c}><Icon name="calendar" size={14} /> {c}</li>)}
          </ul>
          <p className="tiny-note" style={{ marginTop: 10 }}>Best for: {m.bestFor.join(' · ')}</p>
        </div>
      </div>
    </>
  );
}

function PhaseDetail({ phase, index, total, items, prevComplete, canEdit, isAdmin, busy, onAction, onEdit }: {
  phase: Phase; index: number; total: number; items: Issue[]; prevComplete: boolean; canEdit: boolean; isAdmin: boolean; busy: boolean;
  onAction: (action: string, decision?: string) => void; onEdit: (body: object) => void;
}) {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const { member, locale } = useWs();
  const [, setParams] = useSearchParams();
  const [decision, setDecision] = useState('');
  const [gateText, setGateText] = useState(phase.gate);
  const gate = gateWord(m);
  const unit = term(m.id, 'phase');
  const work = items.filter((i) => i.type !== 'epic');
  const done = work.filter((i) => i.statusCategory === 'done').length;
  const open = work.length - done;
  const pct = work.length ? Math.round((done / work.length) * 100) : phase.state === 'complete' ? 100 : 0;
  const today = todayISO();
  const late = phase.state !== 'complete' && !!phase.endDate && phase.endDate < today;
  const daysLeft = phase.endDate ? daysBetween(today, phase.endDate) : null;
  const addType = m.types.includes('task') ? 'task' : m.types.includes('story') ? 'story' : m.types[0];

  const approve = async () => {
    if (open > 0 && !decision.trim()) {
      toast(`${open} item${open === 1 ? ' is' : 's are'} still open. Record your decision (e.g. approved with exceptions) to pass the ${gate}.`, { tone: 'error' });
      return;
    }
    const body = index < total - 1 ? `The next ${lower(unit)} will open automatically.` : `This is the final ${lower(unit)} — approving it closes the lifecycle.`;
    if (await askConfirm({ title: `Approve the ${phase.name} ${gate}?`, body, confirmLabel: `Approve ${gate}` })) {
      onAction('approve', decision.trim());
      setDecision('');
    }
  };

  return (
    <div className={`content-card phase-detail ${phase.state}`}>
      <div className="row-between wrap" style={{ gap: 12 }}>
        <div>
          <span className="eyebrow-sm">{unit} {index + 1} of {total}</span>
          <h3 className="phase-title">{phase.name}</h3>
          <span className={`phase-state ${phase.state}`}>{STATE_LABEL[phase.state]}</span>
          {late && <span className="phase-state late">Overdue</span>}
        </div>
        <div className="phase-dates">
          <label className="form-field compact"><span>Start</span>
            <input type="date" className="text-input slim" value={phase.startDate ?? ''} disabled={!canEdit} onChange={(e) => onEdit({ startDate: e.target.value || null })} />
          </label>
          <label className="form-field compact"><span>{gate === 'stage boundary' ? 'Boundary' : `${cap(gate)} date`}</span>
            <input type="date" className="text-input slim" value={phase.endDate ?? ''} disabled={!canEdit} onChange={(e) => onEdit({ endDate: e.target.value || null })} />
          </label>
        </div>
      </div>

      <div className="phase-progress" role="img" aria-label={`${pct}% complete`}>
        <div className="phase-progress-bar"><i style={{ width: `${pct}%` }} /></div>
        <span>{done}/{work.length} done{daysLeft != null && phase.state !== 'complete' ? ` · ${daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} to ${gate}` : `${-daysLeft} days late`}` : ''}</span>
      </div>

      <div className="phase-grid">
        <div>
          <div className="row-between">
            <h4>Work in this {lower(unit)}</h4>
            {canEdit && phase.state !== 'complete' && (
              <button className="btn btn-soft btn-sm" onClick={() => openCreate({ phaseId: phase.id, type: addType as never })}><Icon name="plus" size={13} /> Add {typeLabel(m, addType as never).toLowerCase()}</button>
            )}
          </div>
          <div className="phase-items">
            {items.map((i) => (
              <button key={i.id} className="phase-item" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('issue', i.key); return n; })}>
                <span className="issue-id">{i.key}</span>
                <span className="phase-item-type">{typeLabel(m, i.type)}</span>
                <span className="ellipsis phase-item-title">{i.title}</span>
                {i.dueDate && <small className={i.dueDate < today && i.statusCategory !== 'done' ? 'overdue' : ''}>{fmtDate(i.dueDate, locale)}</small>}
                <StatusPill name={i.statusName} category={i.statusCategory} />
                <Avatar user={member(i.assigneeId)} size="sm" />
              </button>
            ))}
            {!items.length && <p className="muted">Nothing planned here yet. Add the deliverables and activities needed to meet the {gate} criteria.</p>}
          </div>
        </div>

        <aside className="gate-card">
          <div className="gate-head"><Icon name="lock" size={15} /> {cap(gate)} criteria</div>
          {canEdit && phase.state !== 'complete'
            ? <textarea className="text-input field-textarea" rows={3} value={gateText} maxLength={240} onChange={(e) => setGateText(e.target.value)} onBlur={() => gateText.trim() !== phase.gate && onEdit({ gate: gateText.trim() })} aria-label="Exit criteria" />
            : <p className="gate-text">{phase.gate || 'No criteria set.'}</p>}
          <ul className="gate-checks">
            <li className={open === 0 ? 'ok' : ''}><Icon name={open === 0 ? 'checkcircle' : 'clock'} size={14} /> {open === 0 ? 'All work complete' : `${open} item${open === 1 ? '' : 's'} still open`}</li>
            <li className={prevComplete ? 'ok' : ''}><Icon name={prevComplete ? 'checkcircle' : 'lock'} size={14} /> {index === 0 ? `First ${lower(unit)}` : prevComplete ? `Previous ${gate} passed` : `Waiting on the previous ${gate}`}</li>
          </ul>
          {phase.decision && phase.state !== 'pending' && <div className="gate-decision"><small>Last decision</small><p>{phase.decision}</p></div>}

          {canEdit && (
            <div className="stack-8" style={{ marginTop: 12 }}>
              {phase.state === 'pending' && (
                <button className="btn btn-primary" disabled={!prevComplete || busy} onClick={() => onAction('start')} title={prevComplete ? '' : `Pass the previous ${gate} first`}><Icon name="play" size={14} /> Start {lower(unit)}</button>
              )}
              {phase.state === 'active' && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('submit')}><Icon name="send" size={14} /> Submit for {gate} review</button>}
              {(phase.state === 'review' || phase.state === 'active') && (
                <>
                  <textarea className="text-input field-textarea" rows={2} value={decision} maxLength={1000} onChange={(e) => setDecision(e.target.value)}
                    placeholder={open ? 'Decision & conditions (required while items are open)' : 'Decision notes (optional)'} aria-label={`${cap(gate)} decision`} />
                  <div className="row-8 wrap">
                    <button className={`btn ${phase.state === 'review' ? 'btn-primary' : 'btn-soft'}`} disabled={busy} onClick={approve}><Icon name="checkcircle" size={14} /> Approve {gate}</button>
                    {phase.state === 'review' && <button className="btn btn-light" disabled={busy} onClick={() => { onAction('reject', decision.trim()); setDecision(''); }}>Send back</button>}
                  </div>
                </>
              )}
              {phase.state === 'complete' && isAdmin && (
                <button className="btn btn-light btn-sm" disabled={busy} onClick={async () => (await askConfirm({ title: `Reopen ${phase.name}?`, body: `Later ${lower(term(m.id, 'phases'))} that started will return to “not started”.`, confirmLabel: 'Reopen' })) && onAction('reopen')}>
                  <Icon name="refresh" size={13} /> Reopen
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
