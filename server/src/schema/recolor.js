/**
 * One-time move of the default colours to the Atelier palette. Only the
 * stock colours change (each maps to the same slot in the new palette), so a
 * colour someone typed in themselves is left alone. Used by both databases.
 */
const MAPS = {
  projects: {
    '#7770e7': '#a65a2e', '#30adab': '#6f8a68', '#f09d75': '#5f7c99', '#9e8bb6': '#c58f2c',
    '#e5789a': '#7b4a68', '#5b9be0': '#3f7f78', '#d6a347': '#b9563a', '#4fb38a': '#8c6d4f',
  },
  users: {
    '#6e6ad7': '#8a4a24', '#e99b83': '#5f7c99', '#59a8b0': '#6f8a68', '#dba961': '#b9563a',
    '#967bbd': '#7b4a68', '#64a68e': '#c58f2c', '#d97a9a': '#3f7f78', '#5b8fd6': '#a0705a',
  },
  statuses: {
    '#9698ab': '#a3907d', '#6a8ee9': '#5f7c99', '#edaf5b': '#c58f2c', '#28b391': '#6f8a68',
    '#8278f4': '#a65a2e', '#e5789a': '#c4808a', '#30adab': '#3f7f78',
  },
};

export function recolorSql() {
  return Object.entries(MAPS).map(([table, map]) => {
    const cases = Object.entries(map).map(([from, to]) => `WHEN '${from}' THEN '${to}'`).join(' ');
    return `UPDATE ${table} SET color = CASE lower(color) ${cases} ELSE color END WHERE lower(color) IN (${Object.keys(map).map((c) => `'${c}'`).join(', ')});`;
  }).join('\n');
}
