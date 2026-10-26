import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRunAt, scheduleTriggerOf, jobIdFor } from '../../backend/src/services/scheduler.js';

test('computes the next run from the interval', () => {
  const from = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(computeNextRunAt(15, from), new Date(from + 15 * 60_000).toISOString());
  assert.equal(computeNextRunAt(1440, from), new Date(from + 24 * 60 * 60_000).toISOString());
  assert.equal(computeNextRunAt(0, from), null);
  assert.equal(computeNextRunAt(undefined, from), null);
});

test('finds schedule triggers only', () => {
  const graph = {
    triggers: [
      { id: 't1', type: 'command', config: { command: 'start' } },
      { id: 't2', type: 'schedule', config: { intervalMinutes: 5 } },
    ],
  };
  assert.equal(scheduleTriggerOf(graph).id, 't2');
  assert.equal(scheduleTriggerOf({ triggers: [] }), null);
  assert.equal(scheduleTriggerOf(null), null);
});

test('job ids are stable and filesystem-safe', () => {
  const id = jobIdFor('uid-abc/123', 'bot_1', 'wf_2');
  assert.equal(id, jobIdFor('uid-abc/123', 'bot_1', 'wf_2'));
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(id, jobIdFor('uid-abc/123', 'bot_1', 'wf_3'));
});
