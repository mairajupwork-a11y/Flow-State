import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDue, parseIssueDraft } from '../src/ai/parse.js';

const wed = new Date(Date.UTC(2026, 9, 14)); // Wednesday 14 Oct 2026

test('relative due dates', () => {
  assert.equal(parseDue('do it today', { today: wed }).date, '2026-10-14');
  assert.equal(parseDue('by tomorrow', { today: wed }).date, '2026-10-15');
  assert.equal(parseDue('due friday', { today: wed }).date, '2026-10-16');
  assert.equal(parseDue('on wednesday', { today: wed }).date, '2026-10-21');
  assert.equal(parseDue('in 3 days', { today: wed }).date, '2026-10-17');
  assert.equal(parseDue('next week', { today: wed }).date, '2026-10-21');
});

test('locale-aware numeric and named dates', () => {
  assert.equal(parseDue('due 3/11', { today: wed, locale: 'en-GB' }).date, '2026-11-03');
  assert.equal(parseDue('due 3/11', { today: wed, locale: 'en-US' }).date, '2027-03-11');
  assert.equal(parseDue('by 12 Nov', { today: wed }).date, '2026-11-12');
  assert.equal(parseDue('by Jan 5th', { today: wed }).date, '2027-01-05');
  assert.equal(parseDue('no date here', { today: wed }), null);
});

test('issue drafts keep the meaningful title', () => {
  const members = [{ id: 1, name: 'Alex Morgan' }, { id: 2, name: 'Sarah Chen' }];
  const d = parseIssueDraft('Create a high priority story: redesign pricing page for Sarah due friday #web', { members, me: members[0], today: wed });
  assert.deepEqual(d, { type: 'story', priority: 'high', assigneeId: 2, dueDate: '2026-10-16', labels: ['web'], title: 'Redesign pricing page' });
  const plain = parseIssueDraft('add task update the FAQ', { members, me: members[0], today: wed });
  assert.equal(plain.title, 'Update the FAQ');
  assert.equal(plain.type, 'task');
  assert.equal(plain.assigneeId, null);
});
