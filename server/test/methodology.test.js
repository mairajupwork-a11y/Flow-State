import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METHODOLOGIES, PRIMARY_METHODOLOGIES, REGISTERS, CHARTERS, recommend } from '../../shared/methodologies.js';
import { SAMPLE_WORK } from '../src/templates.js';

test('every methodology is internally consistent', () => {
  for (const m of Object.values(METHODOLOGIES)) {
    assert.ok(m.statuses.some((s) => s[1] === 'todo') && m.statuses.some((s) => s[1] === 'done'), `${m.id} needs to-do and done columns`);
    assert.ok(m.views.includes('board') && m.views.includes('settings'), `${m.id} views`);
    for (const r of m.registers) assert.ok(REGISTERS[r], `${m.id} register ${r}`);
    if (m.charter) assert.ok(CHARTERS[m.charter], `${m.id} charter`);
    assert.equal(!!m.phases, !!m.features.phases, `${m.id} phases flag`);
    assert.equal(m.views.includes('phases'), !!m.phases, `${m.id} phases view`);
    assert.equal(m.views.includes('backlog'), !!m.features.sprints, `${m.id} backlog view`);
    for (const row of SAMPLE_WORK[m.id] ?? []) assert.ok(m.types.includes(row[0]), `${m.id} sample type ${row[0]}`);
  }
});

test('the recommender matches common scenarios', () => {
  assert.equal(recommend({ requirements: 'evolving', work: 'product', size: 'medium', cadence: 'continuous' })[0].id, 'scrumban');
  assert.equal(recommend({ requirements: 'fixed', work: 'project', governance: 'formal', size: 'large', cadence: 'phased' })[0].id, 'prince2');
  assert.equal(recommend({ work: 'improve', governance: 'formal' })[0].id, 'sixsigma');
  assert.equal(recommend({ work: 'stream', cadence: 'continuous', governance: 'light' })[0].id, 'kanban');
  assert.equal(recommend({ requirements: 'fixed', work: 'project', cadence: 'phased', governance: 'light' })[0].id, 'waterfall');
  assert.equal(recommend({ requirements: 'evolving', work: 'product', cadence: 'release' })[0].id, 'scrum');
  assert.equal(recommend({ requirements: 'unknown', size: 'small' })[0].id, 'lean');
  assert.deepEqual([...PRIMARY_METHODOLOGIES].sort(), recommend({}).map((r) => r.id).sort());
});
