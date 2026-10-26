/**
 * In-process scheduler for interval triggers.
 *
 * Schedules are derived from published workflows, so there is no separate job
 * table to drift out of sync: publishing (or resuming) a workflow with a
 * `schedule` trigger creates/refreshes its job, pausing or deleting the
 * workflow removes it. Jobs live in the `scheduledJobs` collection so the
 * next-run time survives restarts.
 */
import { jobRepo, workflowRepo, auditRepo } from '../repositories/index.js';
import { runWorkflowOnce } from './live-runtime.js';
import { nowIso } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import config from '../config.js';
import { WORKFLOW_STATUS } from '../../../shared/constants.js';

export const SCHEDULE_MINUTE = 60_000;

export function jobIdFor(uid, botId, workflowId) {
  return `job_${botId}_${workflowId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120) + `_${uid.slice(0, 6)}`;
}

/** First schedule trigger of a graph, if any. */
export function scheduleTriggerOf(graph) {
  return (graph?.triggers || []).find((trigger) => trigger.type === 'schedule') || null;
}

export function computeNextRunAt(intervalMinutes, from = Date.now()) {
  const minutes = Number(intervalMinutes);
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  return new Date(from + minutes * SCHEDULE_MINUTE).toISOString();
}

/**
 * Create, refresh or remove the job that belongs to a workflow.
 * Safe to call with any workflow state; it always converges.
 */
export async function syncWorkflowSchedule(uid, botId, workflow) {
  const jobId = jobIdFor(uid, botId, workflow.id);
  const graph = workflow.published || null;
  const trigger = graph ? scheduleTriggerOf(graph) : null;
  const active = workflow.status === WORKFLOW_STATUS.PUBLISHED && Boolean(trigger);

  if (!active) {
    const existing = await jobRepo.get(jobId);
    if (existing) await jobRepo.delete(jobId);
    return { enabled: false, jobId };
  }

  const intervalMinutes = Number(trigger.config?.intervalMinutes) || 60;
  const existing = await jobRepo.get(jobId);
  const previousInterval = existing?.intervalMinutes;
  const nextRunAt =
    existing?.nextRunAt && previousInterval === intervalMinutes && existing.nextRunAt > nowIso()
      ? existing.nextRunAt
      : computeNextRunAt(intervalMinutes);

  const job = await jobRepo.upsert({
    id: jobId,
    uid,
    botId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    triggerId: trigger.id,
    intervalMinutes,
    timezone: trigger.config?.timezone || 'UTC',
    enabled: true,
    nextRunAt,
    lastRunAt: existing?.lastRunAt || null,
    lastStatus: existing?.lastStatus || null,
    lastError: existing?.lastError || null,
    runs: existing?.runs || 0,
  });
  return { enabled: true, job };
}

/** Remove a workflow's job (used when a workflow is deleted). */
export async function removeWorkflowSchedule(uid, botId, workflowId) {
  const jobId = jobIdFor(uid, botId, workflowId);
  await jobRepo.delete(jobId);
  return jobId;
}

/** Run every job whose next-run time has passed. Returns a per-job summary. */
export async function runDueJobs({ now = nowIso() } = {}) {
  const due = await jobRepo.list({ dueBefore: now, enabled: true, limit: 25 });
  const results = [];
  for (const job of due) {
    const result = await runJob(job);
    results.push({ jobId: job.id, workflowId: job.workflowId, ...result });
  }
  return results;
}

/** Execute one job immediately (also used by the "Run now" button). */
export async function runJob(job) {
  const workflow = await workflowRepo.get(job.uid, job.botId, job.workflowId).catch(() => null);
  if (!workflow) {
    await jobRepo.update(job.id, { enabled: false, lastError: 'workflow_missing', nextRunAt: null });
    return { status: 'skipped', reason: 'workflow_missing' };
  }
  if (workflow.status !== WORKFLOW_STATUS.PUBLISHED) {
    await jobRepo.update(job.id, { enabled: false, lastError: `workflow_${workflow.status}`, nextRunAt: null });
    return { status: 'skipped', reason: `workflow_${workflow.status}` };
  }
  const graph = workflow.published;
  const trigger = scheduleTriggerOf(graph);
  if (!trigger) {
    await jobRepo.update(job.id, { enabled: false, lastError: 'schedule_trigger_missing', nextRunAt: null });
    return { status: 'skipped', reason: 'schedule_trigger_missing' };
  }

  const startedAt = nowIso();
  try {
    const outcome = await runWorkflowOnce({
      uid: job.uid,
      botId: job.botId,
      workflow,
      graph: workflow.published,
      trigger,
      event: {
        type: 'schedule',
        text: '',
        command: null,
        callbackData: null,
        chat: { id: '', type: 'scheduler' },
        user: { id: '', username: '', firstName: '' },
        scheduledAt: startedAt,
      },
      triggerType: 'schedule',
      inputSummary: `scheduled run (every ${job.intervalMinutes}m)`,
      idempotencyKey: `schedule:${job.botId}:${job.workflowId}:${startedAt}`,
    });

    await jobRepo.update(job.id, {
      lastRunAt: startedAt,
      lastStatus: outcome.status,
      lastError: outcome.error?.code || null,
      runs: (job.runs || 0) + 1,
      nextRunAt: computeNextRunAt(job.intervalMinutes),
    });
    await auditRepo
      .record(job.uid, { action: 'schedule.run', botId: job.botId, workflowId: job.workflowId, status: outcome.status })
      .catch(() => {});
    return { status: outcome.status, executionId: outcome.executionId, error: outcome.error || null };
  } catch (err) {
    logger.warn('scheduled run failed', { workflowId: job.workflowId, code: err.code });
    await jobRepo.update(job.id, {
      lastRunAt: startedAt,
      lastStatus: 'failed',
      lastError: err.code || 'error',
      nextRunAt: computeNextRunAt(job.intervalMinutes),
    });
    return { status: 'failed', error: { code: err.code || 'error', message: err.message } };
  }
}

/** Schedule overview for one bot: every schedule trigger and its job state. */
export async function listSchedules(uid, botId) {
  const workflows = await workflowRepo.list(uid, botId);
  const rows = [];
  for (const workflow of workflows) {
    const graph = workflow.published || workflow.draft;
    const trigger = scheduleTriggerOf(graph);
    if (!trigger) continue;
    const job = await jobRepo.get(jobIdFor(uid, botId, workflow.id));
    rows.push({
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowStatus: workflow.status,
      triggerId: trigger.id,
      intervalMinutes: Number(trigger.config?.intervalMinutes) || 60,
      timezone: trigger.config?.timezone || 'UTC',
      active: workflow.status === WORKFLOW_STATUS.PUBLISHED,
      nextRunAt: job?.nextRunAt || null,
      lastRunAt: job?.lastRunAt || null,
      lastStatus: job?.lastStatus || null,
      lastError: job?.lastError || null,
      runs: job?.runs || 0,
    });
  }
  return rows;
}

let timer = null;

/** Start the scheduler loop (no-op when disabled in configuration). */
export function startScheduler({ tickSeconds = config.runtime.schedulerTickSeconds } = {}) {
  if (timer) return timer;
  const interval = Math.max(Number(tickSeconds) || 30, 5) * 1000;
  timer = setInterval(() => {
    runDueJobs().catch((err) => logger.warn('scheduler tick failed', { message: err.message }));
  }, interval);
  timer.unref?.();
  logger.info('scheduler started', { tickSeconds: interval / 1000 });
  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function schedulerState() {
  return {
    enabled: Boolean(config.runtime.schedulerEnabled),
    running: Boolean(timer),
    tickSeconds: config.runtime.schedulerTickSeconds,
    note: config.runtime.schedulerEnabled
      ? 'Interval schedules are executed by the in-process scheduler.'
      : 'Set SCHEDULER_ENABLED=true to run interval schedules automatically. Manual runs still work.',
  };
}
