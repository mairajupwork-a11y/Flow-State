import { dayOffset, isoDay } from '../dates.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Finds a due date phrase in free text. Returns { date, match } or null.
 * Numeric dates follow the workspace locale (day-first for UK/Asia, month-first for US).
 */
export function parseDue(text, { locale = 'en-GB', today = new Date() } = {}) {
  const t = text.toLowerCase();
  const rules = [
    [/\b(?:due |by )?(?:end of )?today\b|\beod\b/, () => 0],
    [/\b(?:due |by )?tomorrow\b/, () => 1],
    [/\b(?:due |by )?next week\b/, () => 7],
    [/\b(?:due |by )?(?:end of (?:the )?week|this week)\b/, () => (5 - today.getUTCDay() + 7) % 7],
    [/\b(?:due |by )?in (\d{1,3}) days?\b/, (m) => Number(m[1])],
    [/\b(?:due |by )?in (\d{1,2}) weeks?\b/, (m) => Number(m[1]) * 7],
    [new RegExp(`\\b(?:due |by |on )?(next |this )?(${WEEKDAYS.join('|')})\\b`), (m) => {
      const target = WEEKDAYS.indexOf(m[2]);
      let diff = (target - today.getUTCDay() + 7) % 7;
      if (diff === 0 || m[1] === 'next ') diff += 7;
      return diff;
    }],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) return { date: dayOffset(fn(m), today), match: m[0] };
  }
  // "12 Nov", "Nov 12", "12th November"
  const named = t.match(new RegExp(`\\b(?:due |by |on )?(?:(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.join('|')})[a-z]*|(${MONTHS.join('|')})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?)\\b`));
  if (named) {
    const day = Number(named[1] ?? named[4]);
    const month = MONTHS.indexOf(named[2] ?? named[3]);
    return { date: futureDate(today, month, day), match: named[0] };
  }
  const numeric = t.match(/\b(?:due |by |on )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const [a, b] = [Number(numeric[1]), Number(numeric[2])];
    const [day, month] = locale === 'en-US' ? [b, a] : [a, b];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = numeric[3] ? Number(numeric[3].length === 2 ? '20' + numeric[3] : numeric[3]) : null;
      return { date: year ? isoDay(new Date(Date.UTC(year, month - 1, day))) : futureDate(today, month - 1, day), match: numeric[0] };
    }
  }
  return null;
}

function futureDate(today, month, day) {
  let d = new Date(Date.UTC(today.getUTCFullYear(), month, day));
  if (isoDay(d) < isoDay(today)) d = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
  return isoDay(d);
}

/**
 * Turns "create an urgent bug: checkout button broken, assign to Sam, due Friday"
 * into a work item draft. Unrecognised words stay in the title.
 */
export function parseIssueDraft(text, { members = [], me, locale, today } = {}) {
  let rest = ` ${text} `;
  const remove = (fragment) => { rest = rest.replace(fragment, ' '); };

  const lead = rest.match(/^\s*(?:please\s+)?(?:can you\s+)?(?:create|add|new|log|raise|make|open|file)\s+(?:(?:me an?|an|a|new)\s+)?/i);
  if (lead) remove(lead[0]);

  let type = 'task';
  const typeMatch = rest.match(/\b(bug|defect|story|user story|task|epic|feature)\b\s*(?:to|for|about|called|named|:|-)?/i);
  if (typeMatch) {
    const word = typeMatch[1].toLowerCase();
    type = word === 'defect' ? 'bug' : word === 'user story' ? 'story' : word;
    remove(typeMatch[0]);
  }

  let priority = 'medium';
  const pri = rest.match(/\b(?:with |as |at |set to |priority[: ]+)?(urgent|asap|critical|blocker|high|important|medium|normal|low|minor)(?: priority)?\b/i);
  if (pri) {
    const p = pri[1].toLowerCase();
    priority = ['urgent', 'asap', 'critical', 'blocker'].includes(p) ? 'urgent' : ['high', 'important'].includes(p) ? 'high' : ['low', 'minor'].includes(p) ? 'low' : 'medium';
    remove(pri[0]);
  }

  let assigneeId = null;
  const assign = rest.match(/\b(?:assign(?:ed)?(?: it)? to|for|owner[: ]+|@)\s*(me|myself|[A-Za-z][A-Za-z'-]+)/i);
  if (assign) {
    const who = assign[1].toLowerCase();
    const person = who === 'me' || who === 'myself' ? me : members.find((m) => m.name.toLowerCase().split(/\s+/).includes(who));
    if (person) {
      assigneeId = person.id;
      remove(assign[0]);
    }
  }

  let dueDate = null;
  const due = parseDue(rest, { locale, today });
  if (due) {
    dueDate = due.date;
    rest = rest.replace(new RegExp(due.match.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ');
  }

  const labels = [...rest.matchAll(/#([\w-]{2,30})/g)].map((m) => m[1]);
  rest = rest.replace(/#[\w-]{2,30}/g, ' ');

  const title = rest
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,\-–—]+|[\s:,\-–—.]+$/g, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*(?:and\s*)?,/g, ',')
    .replace(/(?:,\s*)+$/, '')
    .replace(/^(?:to|for|about|called|named)\s+/i, '');
  return { type, priority, assigneeId, dueDate, labels, title: title ? title[0].toUpperCase() + title.slice(1) : '' };
}
