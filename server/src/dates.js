/** Calendar dates are stored as ISO YYYY-MM-DD strings (UTC-based, no time component). */
export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function dayOffset(days, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** True only for a YYYY-MM-DD string that is a real calendar day (no 2026-02-31 or 2026-13-01). */
export function isRealDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
