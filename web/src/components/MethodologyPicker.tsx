import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { CHARTERS, METHODOLOGIES, PRIMARY_METHODOLOGIES, REGISTERS, FAMILY_COLOR, recommend, term, viewMeta, type MethodologyId } from '../lib/methodology';

type Answers = Partial<Record<'requirements' | 'work' | 'governance' | 'size' | 'cadence', string>>;

const QUESTIONS: { key: keyof Answers; label: string; options: [string, string][] }[] = [
  { key: 'work', label: 'What are you delivering?', options: [['product', 'A product or app'], ['project', 'A one-off project'], ['stream', 'Ongoing requests / support'], ['improve', 'Improving a process']] },
  { key: 'requirements', label: 'How well are requirements known?', options: [['fixed', 'Fixed up front'], ['evolving', 'Will evolve'], ['unknown', 'Need validating']] },
  { key: 'size', label: 'How big is it?', options: [['small', 'Small team'], ['medium', 'Medium'], ['large', 'Large / multi-team']] },
  { key: 'governance', label: 'How much sign-off is needed?', options: [['light', 'Light, team-led'], ['formal', 'Formal approvals / board']] },
  { key: 'cadence', label: 'How do you want to deliver?', options: [['release', 'Regular releases'], ['continuous', 'Continuously'], ['phased', 'In sequential phases']] },
];

const OPTIONS: MethodologyId[] = [...PRIMARY_METHODOLOGIES, 'business'];

/**
 * Methodology chooser: comparison cards, a "help me choose" questionnaire
 * that ranks practices by fit, and a preview of exactly what gets set up.
 */
export function MethodologyPicker({ value, onChange, compact = false }: { value: MethodologyId; onChange: (id: MethodologyId) => void; compact?: boolean }) {
  const [wizard, setWizard] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const ranked = useMemo(() => recommend(answers), [answers]);
  const answered = Object.keys(answers).length;
  const best = answered ? ranked[0] : null;

  return (
    <div className="method-picker">
      <div className="row-between wrap" style={{ gap: 8 }}>
        <span className="tiny-note">{compact ? 'Choose how this project is run' : 'Seven proven practices — each sets up the right board, views, terms and reports.'}</span>
        <button type="button" className={`btn btn-sm ${wizard ? 'btn-soft' : 'btn-light'}`} onClick={() => setWizard(!wizard)} aria-expanded={wizard}>
          <Icon name="sparkles" size={13} /> {wizard ? 'Hide questions' : 'Help me choose'}
        </button>
      </div>

      {wizard && (
        <div className="method-wizard">
          {QUESTIONS.map((q) => (
            <fieldset key={q.key} className="plain method-q">
              <legend>{q.label}</legend>
              <div className="chip-row">
                {q.options.map(([v, label]) => (
                  <button type="button" key={v} className={`choice-chip sm ${answers[q.key] === v ? 'selected' : ''}`} aria-pressed={answers[q.key] === v}
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: a[q.key] === v ? undefined : v }))}>{label}</button>
                ))}
              </div>
            </fieldset>
          ))}
          {best && (
            <div className="method-rec" role="status">
              <div>
                <span className="eyebrow-sm">Best fit</span>
                <b>{METHODOLOGIES[best.id].name}</b>
                <p>{[...new Set(best.reasons)].slice(0, 3).join(' · ') || METHODOLOGIES[best.id].tagline}</p>
                <small className="muted">Also consider: {ranked.slice(1, 3).map((r) => METHODOLOGIES[r.id].name).join(', ')}</small>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onChange(best.id)} disabled={value === best.id}>{value === best.id ? 'Selected' : `Use ${METHODOLOGIES[best.id].name}`}</button>
            </div>
          )}
        </div>
      )}

      <div className={`method-grid ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Methodology">
        {OPTIONS.map((id) => {
          const m = METHODOLOGIES[id];
          const fit = answered ? ranked.findIndex((r) => r.id === id) : -1;
          return (
            <button type="button" key={id} role="radio" aria-checked={value === id} className={`method-card ${value === id ? 'selected' : ''} ${id === 'business' ? 'simple' : ''}`} onClick={() => onChange(id)}>
              {fit === 0 && <span className="rec-badge">Best fit</span>}
              <span className="method-top">
                <span className="metric-symbol" style={{ background: `${FAMILY_COLOR[m.family]}22`, color: FAMILY_COLOR[m.family] }}><Icon name={m.icon} size={16} /></span>
                <span className="method-family" style={{ color: FAMILY_COLOR[m.family] }}>{m.family}</span>
              </span>
              <b>{m.name}</b>
              <p>{m.tagline}</p>
              {!compact && <small className="method-best">{m.bestFor.slice(0, 2).join(' · ')}</small>}
            </button>
          );
        })}
      </div>

      <MethodologyPreview id={value} />
    </div>
  );
}

/** What choosing a methodology sets up — the "accurate structure" made visible. */
export function MethodologyPreview({ id }: { id: MethodologyId }) {
  const m = METHODOLOGIES[id];
  return (
    <div className="method-preview" aria-live="polite">
      <div className="method-preview-head">
        <div>
          <b>{m.name}</b> <span className="muted-inline">· {m.scale} · {m.cadence}</span>
          <p>{m.description}</p>
        </div>
      </div>
      <div className="method-preview-grid">
        <div>
          <small>Board columns</small>
          <div className="mini-columns">
            {m.statuses.map(([name, , color, wip]) => <span key={name} className="mini-col" style={{ borderTopColor: color }}>{name}{wip ? <em>WIP {wip}</em> : null}</span>)}
          </div>
        </div>
        {m.phases && (
          <div>
            <small>{term(m.id, 'phases')} &amp; gates</small>
            <ol className="mini-phases">{m.phases.map((p) => <li key={p.name} title={p.gate}>{p.name}</li>)}</ol>
          </div>
        )}
        <div>
          <small>Views</small>
          <div className="chip-row">{m.views.filter((v) => v !== 'settings').map((v) => <span key={v} className="mini-chip"><Icon name={viewMeta(m, v).icon} size={12} /> {viewMeta(m, v).label}</span>)}</div>
        </div>
        <div>
          <small>Work item types</small>
          <div className="chip-row">{m.types.map((t) => <span key={t} className="mini-chip">{term(m.id, t)}</span>)}</div>
        </div>
        {(m.registers.length > 0 || m.charter) && (
          <div>
            <small>Governance</small>
            <div className="chip-row">
              {m.charter && <span className="mini-chip"><Icon name={CHARTERS[m.charter].icon} size={12} /> {CHARTERS[m.charter].title}</span>}
              {m.registers.map((r) => <span key={r} className="mini-chip"><Icon name={REGISTERS[r].icon} size={12} /> {REGISTERS[r].label}</span>)}
            </div>
          </div>
        )}
        <div>
          <small>Rhythm</small>
          <div className="chip-row">{m.ceremonies.map((c) => <span key={c} className="mini-chip">{c}</span>)}</div>
        </div>
      </div>
    </div>
  );
}
