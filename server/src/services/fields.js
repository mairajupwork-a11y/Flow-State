import { HttpError } from '../http.js';
import { ISO_DATE } from '../dates.js';

/** Custom field types and how their values are checked and stored (always as text). */
export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url', 'person'];

/** Turns stored text back into the field's natural value for the API. */
export function readFieldValue(field, raw) {
  if (raw == null) return null;
  switch (field.type) {
    case 'number': return Number(raw);
    case 'checkbox': return raw === 'true';
    case 'person': return Number(raw);
    case 'multiselect': try { return JSON.parse(raw); } catch { return []; }
    default: return raw;
  }
}

/** Validates a value for a field; returns the text to store, or null to clear it. */
export async function writeFieldValue(db, field, value, workspaceId) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
  const bad = (msg) => { throw new HttpError(400, `${field.name}: ${msg}`); };
  switch (field.type) {
    case 'text': if (typeof value !== 'string') bad('enter some text'); return value.trim().slice(0, 2000) || null;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(n)) bad('enter a number');
      return String(n);
    }
    case 'date': if (typeof value !== 'string' || !ISO_DATE.test(value)) bad('use a YYYY-MM-DD date'); return value;
    case 'select': if (!field.options.includes(value)) bad(`choose one of: ${field.options.join(', ')}`); return value;
    case 'multiselect': {
      const list = Array.isArray(value) ? [...new Set(value)] : bad('choose from the list');
      if (list.some((v) => !field.options.includes(v))) bad(`choose from: ${field.options.join(', ')}`);
      return JSON.stringify(list);
    }
    case 'checkbox': if (typeof value !== 'boolean') bad('tick or untick it'); return value ? 'true' : null;
    case 'url': {
      let u;
      try { u = new URL(String(value).trim()); } catch { bad('enter a full link starting with https://'); }
      if (!['http:', 'https:'].includes(u.protocol)) bad('links must start with http:// or https://');
      return u.toString().slice(0, 2000);
    }
    case 'person': {
      const id = Number(value);
      if (!Number.isInteger(id) || !await db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', workspaceId, id)) bad('choose a workspace member');
      return String(id);
    }
    default: bad('unknown field type');
  }
  return null;
}
