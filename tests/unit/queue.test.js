import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, QueueFullError } from '../../backend/src/services/queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runs jobs with the configured concurrency', async () => {
  let active = 0;
  let peak = 0;
  const done = [];
  const queue = createQueue({
    concurrency: 2,
    handler: async (payload) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(10);
      active -= 1;
      done.push(payload.id);
    },
  });
  for (let i = 0; i < 6; i += 1) queue.enqueue({ id: i });
  await queue.drain(5000);
  assert.equal(done.length, 6);
  assert.equal(peak, 2, 'never exceeds the concurrency limit');
  assert.equal(queue.stats().completed, 6);
});

test('retries a job that asks for a retry and then succeeds', async () => {
  let attempts = 0;
  const queue = createQueue({
    maxAttempts: 3,
    retryBaseMs: 1,
    handler: async () => {
      attempts += 1;
      return attempts < 3 ? { retry: true, delayMs: 1 } : { result: 'ok' };
    },
  });
  queue.enqueue({});
  await queue.drain(5000);
  assert.equal(attempts, 3);
  assert.equal(queue.stats().completed, 1);
  assert.equal(queue.stats().retried, 2);
});

test('a thrown retryable error is retried, a fatal one is not', async () => {
  let fatalCalls = 0;
  const fatal = createQueue({
    maxAttempts: 3,
    retryBaseMs: 1,
    handler: async () => {
      fatalCalls += 1;
      const err = new Error('nope');
      err.code = 'invalid_payload';
      throw err;
    },
  });
  fatal.enqueue({});
  await fatal.drain(5000);
  assert.equal(fatalCalls, 1);
  assert.equal(fatal.stats().failed, 1);

  let rateLimited = 0;
  const retrying = createQueue({
    maxAttempts: 2,
    retryBaseMs: 1,
    handler: async () => {
      rateLimited += 1;
      if (rateLimited === 1) {
        const err = new Error('slow down');
        err.code = 'rate_limited';
        err.retryAfter = 0;
        throw err;
      }
    },
  });
  retrying.enqueue({});
  await retrying.drain(5000);
  assert.equal(rateLimited, 2);
  assert.equal(retrying.stats().completed, 1);
});

test('duplicate dedupe keys are dropped while a job is in flight', async () => {
  const seen = [];
  const queue = createQueue({
    concurrency: 1,
    handler: async (payload) => {
      seen.push(payload.id);
      await sleep(5);
    },
  });
  assert.equal(queue.enqueue({ id: 'a' }, { dedupeKey: 'same' }), true);
  assert.equal(queue.enqueue({ id: 'b' }, { dedupeKey: 'same' }), false);
  await queue.drain(5000);
  assert.deepEqual(seen, ['a']);
  assert.equal(queue.stats().duplicates, 1);
  // The key is released after the job settles, so a later job is accepted.
  assert.equal(queue.enqueue({ id: 'c' }, { dedupeKey: 'same' }), true);
  await queue.drain(5000);
  assert.deepEqual(seen, ['a', 'c']);
});

test('a full queue rejects new work instead of growing without bound', async () => {
  const queue = createQueue({ concurrency: 1, maxPending: 1, handler: () => sleep(20) });
  queue.enqueue({ id: 1 });
  queue.enqueue({ id: 2 });
  assert.throws(() => queue.enqueue({ id: 3 }), QueueFullError);
  await queue.drain(5000);
  assert.equal(queue.stats().dropped, 1);
});

test('onSettled reports the final outcome of each job', async () => {
  const outcomes = [];
  const queue = createQueue({
    maxAttempts: 1,
    handler: async (payload) => {
      if (payload.fail) throw Object.assign(new Error('boom'), { code: 'boom' });
      return { result: 'fine' };
    },
    onSettled: ({ status, error }) => outcomes.push({ status, error }),
  });
  queue.enqueue({ fail: false });
  queue.enqueue({ fail: true });
  await queue.drain(5000);
  assert.deepEqual(outcomes.map((o) => o.status).sort(), ['completed', 'failed']);
});
