import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Empty } from '../../components/ui';
import { FieldInput } from '../../components/FieldInput';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs } from '../../lib/workspace';
import { toast } from '../../lib/store';
import { CHARTERS, methodologyOf } from '../../lib/methodology';
import type { FieldValues } from '../../lib/types';
import { SectionBar, useProjectCtx } from './ProjectLayout';

const INTRO: Record<string, string> = {
  waterfall: 'Agree the objective, scope and acceptance criteria before work starts. Changes after sign-off go through the change log.',
  sixsigma: 'The charter anchors every tollgate. Keep the problem statement factual (no causes or solutions) and the goal SMART.',
  prince2: 'Continued business justification is a PRINCE2 principle: revisit the business case at every stage boundary. Tolerances define when the Project Manager must escalate to the Project Board.',
  lean: 'Value is defined by the customer. Map the steps that deliver it so waste becomes visible.',
};

/** The project definition document for methodologies that use one. */
export default function Charter() {
  const { project } = useProjectCtx();
  const m = methodologyOf(project);
  const { canEdit, members } = useWs();
  const qc = useQueryClient();
  const def = m.charter ? CHARTERS[m.charter] : null;
  const saved = project.settings.charter ?? {};
  const [values, setValues] = useState<FieldValues>(saved);
  useEffect(() => setValues(project.settings.charter ?? {}), [project.settings.charter]);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const save = useMutation({ mutationFn: () => api.patch(`/projects/${project.id}`, { charter: values }), onSuccess: () => { invalidateWork(qc); toast(`${def?.title ?? 'Charter'} saved.`); } });

  if (!def) return <><SectionBar title="Charter" /><Empty icon="folder" title="No charter for this methodology">{m.name} doesn’t use a formal project definition.</Empty></>;

  const filled = def.fields.filter((f) => values[f.key] != null && values[f.key] !== '').length;
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const groups = m.charter === 'prince2'
    ? [['Business case', def.fields.slice(0, 6)], ['Tolerances', def.fields.slice(6, 10)], ['Project Board & roles', def.fields.slice(10)]] as const
    : m.charter === 'sixsigma'
      ? [['Problem & goal', def.fields.slice(0, 3)], ['CTQ & specification', def.fields.slice(3, 11)], ['Team', def.fields.slice(11)]] as const
      : [[def.title, def.fields]] as const;

  return (
    <>
      <SectionBar title={def.title} sub={`${m.name} · ${filled} of ${def.fields.length} fields complete`} />
      <form className="charter-layout" onSubmit={submit}>
        <div className="stack-14">
          {groups.map(([title, fields]) => (
            <section className="content-card" key={title}>
              <h3>{title}</h3>
              <fieldset className="plain field-grid" disabled={!canEdit} style={{ marginTop: 14 }}>
                {fields.map((f) => <FieldInput key={f.key} field={f} value={values[f.key]} members={members} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />)}
              </fieldset>
            </section>
          ))}
        </div>
        <aside className="content-card charter-aside">
          <span className="metric-symbol" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={def.icon} size={17} /></span>
          <h3 style={{ marginTop: 10 }}>{def.title}</h3>
          <p className="muted">{INTRO[m.charter!]}</p>
          <div className="phase-progress" style={{ margin: '14px 0' }}>
            <div className="phase-progress-bar"><i style={{ width: `${(filled / def.fields.length) * 100}%` }} /></div>
            <span>{Math.round((filled / def.fields.length) * 100)}%</span>
          </div>
          {canEdit && <button className="btn btn-primary" disabled={!dirty || save.isPending}>{dirty ? 'Save changes' : 'Saved'}</button>}
        </aside>
      </form>
    </>
  );
}
