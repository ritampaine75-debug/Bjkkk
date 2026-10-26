/**
 * Execution analytics computed from stored execution records.
 *
 * Everything here is derived from real executions - no synthetic numbers. If
 * there is no data, the response says so instead of inventing values.
 */
import { executionRepo } from '../repositories/index.js';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function dayKey(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : null;
}

export async function getAnalytics(uid, botId, { days = 14, sampleSize = 1000 } = {}) {
  const window = Math.min(Math.max(Number(days) || 14, 1), 90);
  const rows = await executionRepo.list(uid, botId, { limit: sampleSize });
  const cutoff = new Date(Date.now() - window * 86400_000).toISOString();
  const inWindow = rows.filter((row) => (row.startedAt || '') >= cutoff);

  const byStatus = { succeeded: 0, failed: 0, timeout: 0, skipped: 0 };
  const byMode = { live: 0, simulation: 0 };
  const errors = new Map();
  const workflows = new Map();
  const perDay = new Map();
  const durations = [];

  for (const row of inWindow) {
    if (row.status in byStatus) byStatus[row.status] += 1;
    byMode[row.mode === 'simulation' ? 'simulation' : 'live'] += 1;
    if (row.error?.code) errors.set(row.error.code, (errors.get(row.error.code) || 0) + 1);
    if (typeof row.durationMs === 'number') durations.push(row.durationMs);

    const key = row.workflowId || row.workflowName || 'unknown';
    const entry = workflows.get(key) || {
      workflowId: row.workflowId || null,
      workflowName: row.workflowName || 'Unknown workflow',
      runs: 0,
      failures: 0,
      durations: [],
      lastRunAt: null,
      lastStatus: null,
    };
    entry.runs += 1;
    if (row.status !== 'succeeded' && row.status !== 'skipped') entry.failures += 1;
    if (typeof row.durationMs === 'number') entry.durations.push(row.durationMs);
    if (!entry.lastRunAt || (row.startedAt || '') > entry.lastRunAt) {
      entry.lastRunAt = row.startedAt || null;
      entry.lastStatus = row.status || null;
    }
    workflows.set(key, entry);

    const day = dayKey(row.startedAt);
    if (day) {
      const bucket = perDay.get(day) || { date: day, total: 0, succeeded: 0, failed: 0 };
      bucket.total += 1;
      if (row.status === 'succeeded') bucket.succeeded += 1;
      if (row.status === 'failed' || row.status === 'timeout') bucket.failed += 1;
      perDay.set(day, bucket);
    }
  }

  durations.sort((a, b) => a - b);
  const total = inWindow.length;
  const finished = byStatus.succeeded + byStatus.failed + byStatus.timeout;

  const daily = [];
  for (let i = window - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    daily.push(perDay.get(date) || { date, total: 0, succeeded: 0, failed: 0 });
  }

  return {
    window: { days: window, from: cutoff, sampled: rows.length, truncated: rows.length >= sampleSize },
    totals: {
      runs: total,
      ...byStatus,
      successRate: finished > 0 ? Math.round((byStatus.succeeded / finished) * 1000) / 10 : null,
      modes: byMode,
    },
    duration: {
      averageMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      slowestMs: durations.length ? durations[durations.length - 1] : null,
    },
    workflows: [...workflows.values()]
      .map((entry) => ({
        workflowId: entry.workflowId,
        workflowName: entry.workflowName,
        runs: entry.runs,
        failures: entry.failures,
        successRate: entry.runs ? Math.round(((entry.runs - entry.failures) / entry.runs) * 1000) / 10 : null,
        averageMs: entry.durations.length
          ? Math.round(entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length)
          : null,
        lastRunAt: entry.lastRunAt,
        lastStatus: entry.lastStatus,
      }))
      .sort((a, b) => b.runs - a.runs),
    errors: [...errors.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    daily,
  };
}
