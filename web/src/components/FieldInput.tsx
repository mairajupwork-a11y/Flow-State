import type { FieldDef } from '../lib/methodology';
import type { FieldValues, Member } from '../lib/types';

/** One form control for a config-defined field (registers, charters). */
export function FieldInput({ field, value, onChange, members, disabled }: {
  field: FieldDef; value: string | number | null | undefined; onChange: (v: string | number | null) => void; members: Member[]; disabled?: boolean;
}) {
  const id = `f-${field.key}`;
  const common = { id, disabled, 'aria-describedby': field.hint ? `${id}-hint` : undefined };
  let control;
  switch (field.type) {
    case 'textarea':
      control = <textarea {...common} className="text-input field-textarea" rows={3} maxLength={4000} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'number':
      control = <input {...common} className="text-input" type="number" step="any" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
      break;
    case 'date':
      control = <input {...common} className="text-input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
      break;
    case 'member':
      control = (
        <select {...common} className="field-select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Not set</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
      break;
    case 'select':
      control = (
        <select {...common} className="field-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {field.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      );
      break;
    case 'scale': {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      control = (
        <div className="scale-picker" role="radiogroup" aria-labelledby={`${id}-label`}>
          {Array.from({ length: max - min + 1 }, (_, k) => min + k).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={Number(value) === n} disabled={disabled}
              className={`scale-opt ${Number(value) === n ? 'on' : ''}`} style={{ ['--heat' as string]: (n - min) / (max - min || 1) }}
              onClick={() => onChange(Number(value) === n ? null : n)}>{n}</button>
          ))}
        </div>
      );
      break;
    }
    default:
      control = <input {...common} className="text-input" maxLength={4000} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={`form-field ${field.type === 'textarea' ? 'span-2' : ''}`}>
      {field.type === 'scale' ? <span id={`${id}-label`}>{field.label}</span> : <label htmlFor={id}><span>{field.label}</span></label>}
      {control}
      {field.hint && <small id={`${id}-hint`} className="field-hint">{field.hint}</small>}
    </div>
  );
}

/** Human-readable value for tables and summaries. */
export function fieldText(field: FieldDef, value: FieldValues[string] | undefined, members: Member[]): string {
  if (value == null || value === '') return '—';
  if (field.type === 'member') return members.find((m) => m.id === Number(value))?.name ?? '—';
  if (field.type === 'date') return new Date(String(value) + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return String(value);
}
