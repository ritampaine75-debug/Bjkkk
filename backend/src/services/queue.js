/**
 * Small in-process job queue used by the live runtime.
 *
 * It is deliberately boring: bounded concurrency, bounded retries with
 * exponential backoff, deduplication by key, and counters the UI can read.
 * Multi-instance deployments should replace it with a managed queue; the
 * interface (`enqueue`, `stats`, `drain`) is intentionally small so that swap
 * does not touch call sites.
 */
import { logger } from '../utils/logger.js';

export class QueueFullError extends Error {
  constructor(message = 'The execution queue is full. Try again in a moment.') {
    super(message);
    this.name = 'QueueFullError';
    this.code = 'queue_full';
  }
}

export function createQueue({
  name = 'runtime',
  concurrency = 4,
  maxAttempts = 3,
  maxPending = 500,
  retryBaseMs = 500,
  maxRetryDelayMs = 30_000,
  handler,
  onSettled = null,
} = {}) {
  if (typeof handler !== 'function') throw new TypeError('createQueue requires a handler function');

  const pending = [];
  let active = 0;
  let draining = false;
  const seen = new Set();
  const idleWaiters = [];
  const counters = { enqueued: 0, completed: 0, failed: 0, retried: 0, dropped: 0, duplicates: 0 };

  function notifyIdle() {
    if (active === 0 && pending.length === 0) {
      while (idleWaiters.length > 0) idleWaiters.shift()();
    }
  }

  function schedule(delayMs = 0) {
    if (delayMs > 0) {
      // Deliberately referenced: a pending retry must keep the process alive
      // until the job has actually run.
      setTimeout(pump, delayMs);
      return;
    }
    pump();
  }

  function pump() {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift();
      active += 1;
      run(job)
        .catch((err) => logger.warn('queue job crashed', { queue: name, message: err.message }))
        .finally(() => {
          active -= 1;
          if (pending.length > 0) pump();
          else notifyIdle();
        });
    }
    notifyIdle();
  }

  async function run(job) {
    job.attempts += 1;
    try {
      const outcome = (await handler(job.payload, { attempt: job.attempts, job })) || {};
      if (outcome && outcome.retry === true && job.attempts < maxAttempts) {
        counters.retried += 1;
        const delay = Math.min(Number(outcome.delayMs) || retryBaseMs * 2 ** (job.attempts - 1), maxRetryDelayMs);
        job.lastError = outcome.reason || 'retry_requested';
        pending.push(job);
        schedule(delay);
        return;
      }
      if (outcome && outcome.retry === true) {
        counters.failed += 1;
        job.settled = 'failed';
        job.lastError = outcome.reason || 'retries_exhausted';
        await onSettled?.({ job, status: 'failed', error: job.lastError });
        return;
      }
      counters.completed += 1;
      job.settled = 'completed';
      await onSettled?.({ job, status: 'completed', result: outcome?.result ?? null });
    } catch (err) {
      const retryable = err?.retryable === true || err?.code === 'rate_limited' || err?.code === 'network';
      if (retryable && job.attempts < maxAttempts) {
        counters.retried += 1;
        const delay = Math.min(Number(err.retryAfter) * 1000 || retryBaseMs * 2 ** (job.attempts - 1), maxRetryDelayMs);
        job.lastError = err.code || err.message;
        pending.push(job);
        schedule(delay);
        return;
      }
      counters.failed += 1;
      job.settled = 'failed';
      job.lastError = err?.code || err?.message || 'job_failed';
      logger.warn('queue job failed', { queue: name, code: job.lastError });
      await onSettled?.({ job, status: 'failed', error: job.lastError });
    } finally {
      if (job.dedupeKey) seen.delete(job.dedupeKey);
    }
  }

  return {
    name,
    /** @returns {boolean} false when the job was a duplicate or dropped. */
    enqueue(payload, { dedupeKey = null, delayMs = 0 } = {}) {
      if (dedupeKey) {
        if (seen.has(dedupeKey)) {
          counters.duplicates += 1;
          return false;
        }
        seen.add(dedupeKey);
      }
      if (pending.length >= maxPending) {
        counters.dropped += 1;
        throw new QueueFullError();
      }
      const job = { id: `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, payload, dedupeKey, attempts: 0, enqueuedAt: Date.now(), settled: null, lastError: null };
      pending.push(job);
      counters.enqueued += 1;
      schedule(delayMs);
      return true;
    },
    stats() {
      return {
        name,
        concurrency,
        active,
        pending: pending.length,
        maxPending,
        maxAttempts,
        ...counters,
        idle: active === 0 && pending.length === 0,
      };
    },
    /** Resolves when the queue has nothing left to do (used by tests). */
    async drain(timeoutMs = 10_000) {
      if (active === 0 && pending.length === 0) return;
      draining = true;
      try {
        await Promise.race([
          new Promise((resolve) => idleWaiters.push(resolve)),
          new Promise((resolve) => {
            const timer = setTimeout(resolve, timeoutMs);
            timer.unref?.();
          }),
        ]);
      } finally {
        draining = false;
      }
    },
    get draining() {
      return draining;
    },
  };
}
