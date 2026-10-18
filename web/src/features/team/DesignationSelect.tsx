import { useState } from 'react';
import { DESIGNATION_GROUPS, DESIGNATIONS } from '../../../../shared/designations.js';

const OTHER = '__other__';

/** Job title picker: grouped common software-firm roles, plus "Other" to type one in. */
export function DesignationSelect({ value, onChange, label = 'Designation', hint, required = false }: {
  value: string; onChange: (value: string) => void; label?: string; hint?: string; required?: boolean;
}) {
  const [custom, setCustom] = useState(() => !!value && !DESIGNATIONS.includes(value));
  return (
    <label className="form-field" style={{ marginTop: 14 }}>
      <span>{label}{required ? '' : ' (optional)'}</span>
      <select className="field-select" value={custom ? OTHER : value} aria-required={required}
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === OTHER);
          onChange(v === OTHER ? '' : v);
        }}>
        <option value="">{required ? 'Choose their designation…' : 'No designation'}</option>
        {DESIGNATION_GROUPS.map(([group, roles]) => (
          <optgroup key={group} label={group}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </optgroup>
        ))}
        <option value={OTHER}>Other — type it in…</option>
      </select>
      {custom && (
        <input className="text-input" style={{ marginTop: 8 }} value={value} maxLength={80} autoFocus
          onChange={(e) => onChange(e.target.value)} placeholder="e.g. Salesforce Developer" aria-label="Custom designation" />
      )}
      {hint && <small className="tiny-note">{hint}</small>}
    </label>
  );
}
