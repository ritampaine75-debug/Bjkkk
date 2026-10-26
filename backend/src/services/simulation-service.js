/**
 * Virtual Telegram simulator service.
 *
 * Runs the real workflow engine with a mocked Telegram transport. Every
 * execution is persisted with mode "simulation" so it is clearly separated
 * from live runs in the execution history.
 */
import { workflowRepo, executionRepo, botRepo, scenarioRepo, auditRepo } from '../repositories/index.js';
import { validateWorkflow, summarizeWorkflow } from '../../../shared/workflow-schema.js';
import { executeWorkflow } from './workflow-engine.js';
import { createMockTransport } from './transports/mock-transport.js';
import { AppError, badRequest, notFound } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';
import { summarizeText } from '../utils/redact.js';
import config from '../config.js';
import { EXECUTION_MODE, EXECUTION_STATUS } from '../../../shared/constants.js';

const ALLOWED_HOSTS = (process.env.HTTP_ACTION_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

/** Choose the trigger that should answer a simulated event. */
export function matchTrigger(graph, event = {}) {
  const triggers = graph.triggers || [];
  if (event.triggerId) {
    const exact = triggers.find((trigger) => trigger.id === event.triggerId);
    if (!exact) throw badRequest('That trigger does not belong to this workflow.');
    return exact;
  }
  const text = String(event.text || '').trim();
  const command = text.startsWith('/') ? text.slice(1).split(/\s+/)[0].toLowerCase() : null;

  // A tapped inline button is still a message in the chat, so a workflow that
  // listens for text can react to `{{callbackData}}` when no callback trigger exists.
  if (event.type === 'callback' || event.callbackData) {
    const callbackTrigger = triggers.find(
      (trigger) => trigger.type === 'callback' && (trigger.config.matchAny !== false || trigger.config.data === event.callbackData),
    );
    if (callbackTrigger) return callbackTrigger;
    // No callback listener: a tap still reaches a text-triggered workflow, which
    // can branch on `{{callbackData}}`.
  }
  if (command) {
    const match = triggers.find((trigger) => trigger.type === 'command' && trigger.config.command === command);
    if (match) return match;
  }
  if (event.type === 'newMember') {
    const match = triggers.find((trigger) => trigger.type === 'newMember');
    if (match) return match;
  }
  const keyword = triggers.find((trigger) => {
    if (trigger.type !== 'keyword') return false;
    const keywords = trigger.config.keywords || [];
    const haystack = trigger.config.matchMode === 'exact' ? text.toLowerCase() : text.toLowerCase();
    return keywords.some((word) => (trigger.config.matchMode === 'exact' ? haystack === word.toLowerCase() : haystack.includes(word.toLowerCase())));
  });
  if (keyword) return keyword;

  const textTrigger = triggers.find((trigger) => trigger.type === 'text');
  if (textTrigger && ((text && !command) || event.callbackData)) return textTrigger;

  if (event.type === 'manual') {
    return triggers.find((trigger) => trigger.type === 'manual') || null;
  }
  // Fall back to a manual trigger so a draft can always be tested on demand.
  return triggers.find((trigger) => trigger.type === 'manual') || null;
}

function normalizeEvent(input = {}) {
  const text = typeof input.text === 'string' ? input.text.slice(0, 4096) : '';
  const callbackData = typeof input.callbackData === 'string' ? input.callbackData.slice(0, 64) : null;
  return {
    type: input.type || (callbackData ? 'callback' : 'text'),
    text: callbackData ? '' : text,
    callbackData,
    chat: { id: String(input.chatId || '1000'), type: 'private' },
    user: {
      id: String(input.userId || '555001'),
      username: input.username || 'simulator_user',
      first_name: input.firstName || 'Simulated',
      last_name: input.lastName || 'User',
    },
    callbackQueryId: input.callbackQueryId || 'sim-callback',
    message_id: input.messageId ? Number(input.messageId) : undefined,
  };
}

export async function simulate(uid, botId, input = {}, { maxTurns = 1 } = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  if (!input.workflowId) throw badRequest('Choose a workflow to simulate.');

  const workflow = await workflowRepo.get(uid, botId, input.workflowId);
  if (!workflow) throw notFound('Workflow not found.');

  const source = input.source === 'published' ? 'published' : 'draft';
  const graph = source === 'published' ? workflow.published : workflow.draft || workflow.graph;
  if (!graph) throw badRequest('This workflow has no saved graph yet. Save the draft first.');

  const validation = validateWorkflow(graph, {
    allowHttp: Boolean(process.env.ALLOW_HTTP_ACTIONS === 'true' || ALLOWED_HOSTS.length > 0),
    allowedHosts: ALLOWED_HOSTS,
  });
  if (!validation.valid) {
    throw new AppError('The workflow cannot be simulated because it is not valid yet.', {
      status: 422,
      code: 'validation_failed',
      details: validation.errors,
    });
  }

  const event = normalizeEvent(input.event || input);
  const trigger = matchTrigger(graph, {
    ...event,
    triggerId: input.triggerId,
    type: event.type,
  });
  if (!trigger) {
    throw new AppError(
      `No trigger in this workflow matches that input. The workflow listens for: ${summarizeWorkflow(graph).triggerSummary}.`,
      { status: 422, code: 'no_matching_trigger' },
    );
  }

  const transport = createMockTransport({ botUsername: bot.telegram?.username || 'botforge_demo_bot' });
  transport.addIncoming({
    text: event.callbackData ? '' : event.text,
    command: event.text?.startsWith('/') ? event.text.slice(1).split(/\s+/)[0] : null,
    callbackData: event.callbackData,
    kind: event.callbackData ? 'callback' : 'text',
  });

  const startedAt = nowIso();
  const result = await executeWorkflow({
    graph,
    triggerId: trigger.id,
    transport,
    event: { ...event, callbackQueryId: event.callbackQueryId },
    variables: input.variables && typeof input.variables === 'object' ? input.variables : {},
    timeoutMs: config.runtime.executionTimeoutMs,
    maxSteps: config.runtime.executionMaxSteps,
    allowedHosts: ALLOWED_HOSTS,
  });

  const execution = await executionRepo.create(uid, botId, {
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: source === 'published' ? workflow.publishedVersion : null,
    mode: EXECUTION_MODE.SIMULATION,
    triggerType: trigger.type,
    triggerId: trigger.id,
    status: result.status,
    startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stepCount: result.stepCount,
    steps: result.steps,
    variables: result.variables,
    transcript: result.transcript,
    inputSummary: summarizeText(event.callbackData ? `button: ${event.callbackData}` : event.text, 160),
    error: result.error,
    idempotencyKey: null,
    retryCount: 0,
    simulated: true,
  });

  await auditRepo.record(uid, {
    action: 'workflow.simulated',
    botId,
    workflowId: workflow.id,
    status: result.status,
    executionId: execution.id,
  });

  return {
    execution: {
      id: execution.id,
      status: result.status,
      mode: 'simulation',
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      durationMs: result.durationMs,
      stepCount: result.stepCount,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowVersion: execution.workflowVersion,
      triggerType: trigger.type,
      error: result.error,
    },
    trigger: { id: trigger.id, type: trigger.type, config: trigger.config },
    steps: result.steps,
    variables: result.variables,
    transcript: result.transcript,
    source,
    label: 'Simulated execution - no Telegram messages were sent.',
  };
}

/** Persist / list reusable simulator scenarios for a bot. */
export async function listScenarios(uid, botId) {
  return scenarioRepo.list(uid, botId);
}

export async function saveScenario(uid, botId, input = {}) {
  const workflowId = typeof input.workflowId === 'string' ? input.workflowId : null;
  if (workflowId) {
    const workflow = await workflowRepo.get(uid, botId, workflowId);
    if (!workflow) throw badRequest('The selected workflow does not exist for this bot.');
  }
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw badRequest('Give the scenario a name.');
  const events = Array.isArray(input.events) ? input.events.slice(0, 10) : [];
  return scenarioRepo.save(uid, botId, {
    id: typeof input.id === 'string' ? input.id : undefined,
    name,
    description: String(input.description || '').slice(0, 300),
    workflowId,
    events: events.map((event) => ({
      type: ['text', 'callback', 'manual', 'newMember'].includes(event.type) ? event.type : 'text',
      text: String(event.text || '').slice(0, 500),
      callbackData: event.callbackData ? String(event.callbackData).slice(0, 64) : null,
    })),
  });
}

export async function deleteScenario(uid, botId, scenarioId) {
  return scenarioRepo.delete(uid, botId, scenarioId);
}

/** Remove execution records older than the retention window. */
export async function pruneExecutions(uid, botId, { retentionDays = config.runtime.executionRetentionDays } = {}) {
  const { getStore } = await import('../db/index.js');
  const store = await getStore();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const rows = await store.query(`users/${uid}/bots/${botId}/executions`);
  let removed = 0;
  for (const row of rows) {
    if (row.startedAt && row.startedAt < cutoff) {
      await store.doc.delete(`users/${uid}/bots/${botId}/executions/${row.id}`);
      removed += 1;
    }
  }
  return removed;
}

export const __internal = { normalizeEvent, EXECUTION_STATUS };
