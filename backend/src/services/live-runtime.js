/**
 * Live runtime: Telegram updates -> matching published workflows -> real
 * Telegram actions.
 *
 * Guarantees:
 *  - each Telegram update is processed at most once (atomic receipt claim);
 *  - non-idempotent Telegram calls are only made for claimed updates;
 *  - a failing workflow never blocks other workflows in the same update;
 *  - rate limits are retried with the delay Telegram asks for.
 */
import { botRepo, workflowRepo, executionRepo, webhookReceiptRepo, commandRepo } from '../repositories/index.js';
import { getBotTelegramClient } from './bot-client.js';
import { createTelegramTransport } from './transports/mock-transport.js';
import { createRetryingTransport } from './transports/retrying-transport.js';
import { buildCommandReply } from './command-service.js';
import { executeWorkflow } from './workflow-engine.js';
import { parseUpdate, toEngineEvent } from './update-parser.js';
import { createQueue } from './queue.js';
import { summarizeText } from '../utils/redact.js';
import { nowIso } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import config from '../config.js';
import { workflowOptions } from './workflow-service.js';
import { EXECUTION_MODE, EXECUTION_STATUS, WORKFLOW_STATUS } from '../../../shared/constants.js';

const { allowedHosts: ALLOWED_HOSTS } = workflowOptions();
const inFlightByWorkflow = new Map();
const runtimeEvents = [];
let lastUpdateAt = null;
let processedUpdates = 0;

function recordRuntimeEvent(entry) {
  runtimeEvents.unshift({ ...entry, at: nowIso() });
  if (runtimeEvents.length > 50) runtimeEvents.length = 50;
}

/** Does a trigger fire for this parsed update? */
export function triggerMatches(trigger, parsed) {
  if (!trigger || !parsed) return false;
  const cfg = trigger.config || {};
  switch (trigger.type) {
    case 'command':
      return parsed.kind === 'message' && Boolean(parsed.command) && parsed.command === String(cfg.command || '').toLowerCase();
    case 'text':
      return parsed.kind === 'message' && !parsed.command && Boolean(parsed.text);
    case 'keyword': {
      if (parsed.kind !== 'message' || !parsed.text) return false;
      const words = (cfg.keywords || []).map((word) => String(word).toLowerCase());
      if (words.length === 0) return false;
      const haystack = parsed.text.toLowerCase();
      return words.some((word) => (cfg.matchMode === 'exact' ? haystack === word : haystack.includes(word)));
    }
    case 'callback':
      if (parsed.kind !== 'callback') return false;
      if (cfg.matchAny === false) return String(cfg.data || '') === String(parsed.callbackData || '');
      return true;
    case 'newMember':
      return parsed.kind === 'newMember';
    case 'schedule':
    case 'manual':
      return false; // never triggered by an inbound update
    default:
      return false;
  }
}

/** Published workflows whose trigger fires for this update, best match first. */
export async function selectWorkflows(uid, botId, parsed) {
  const rows = await workflowRepo.listPublishedForBot(uid, botId).catch(() => []);
  const matches = [];
  for (const row of rows) {
    if (row.status !== WORKFLOW_STATUS.PUBLISHED) continue;
    const graph = row.published || row.draft;
    if (!graph) continue;
    const trigger = (graph.triggers || []).find((candidate) => triggerMatches(candidate, parsed));
    if (trigger) matches.push({ workflow: row, graph, trigger });
  }
  // Commands are the most specific trigger, keyword next, text last.
  const rank = { command: 0, callback: 1, keyword: 2, newMember: 3, text: 4 };
  return matches.sort((a, b) => (rank[a.trigger.type] ?? 9) - (rank[b.trigger.type] ?? 9));
}

/** Bot-level allow/block list. `everyone` allows all traffic. */
export function isBotUserAllowed(bot, userId) {
  const mode = bot?.restrictions?.mode || 'everyone';
  const ids = (bot?.restrictions?.userIds || []).map(String);
  const id = String(userId ?? '');
  if (mode === 'allowlist') return ids.includes(id);
  if (mode === 'blocklist') return !ids.includes(id);
  return true;
}

/** Per-command access rules. */
export function isCommandUserAllowed(command, userId) {
  const blocked = (command?.access?.blockedUserIds || []).map(String);
  const restricted = (command?.access?.restrictedToUserIds || []).map(String);
  const id = String(userId ?? '');
  if (blocked.includes(id)) return false;
  if (restricted.length > 0 && !restricted.includes(id)) return false;
  return true;
}

function cooldownRemainingMs(workflow) {
  const seconds = Number(workflow.settings?.cooldownSeconds) || 0;
  if (!seconds || !workflow.lastRunAt) return 0;
  const elapsed = Date.now() - new Date(workflow.lastRunAt).getTime();
  return Math.max(0, seconds * 1000 - elapsed);
}

/**
 * Process one Telegram update. Returns a summary used by the webhook route and
 * by the live-test lab.
 */
export async function processUpdate({ uid, botId, update, client = null }) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) return { skipped: 'bot_missing' };
  if (bot.status === 'revoked') return { skipped: 'bot_revoked' };

  const parsed = parseUpdate(update);
  if (!parsed.updateId) return { skipped: 'missing_update_id' };
  if (parsed.kind === 'unsupported') {
    recordRuntimeEvent({ botId, kind: 'ignored', reason: parsed.reason });
    return { skipped: parsed.reason };
  }

  const claimed = await webhookReceiptRepo.claim(botId, parsed.updateId, {
    uid,
    kind: parsed.kind,
    chatId: parsed.chat?.id || null,
  });
  if (claimed === false) {
    recordRuntimeEvent({ botId, kind: 'duplicate', updateId: parsed.updateId });
    return { duplicate: true, updateId: parsed.updateId };
  }

  if (!isBotUserAllowed(bot, parsed.user?.id)) {
    recordRuntimeEvent({ botId, kind: 'restricted_user', userId: parsed.user?.id || null });
    return { updateId: parsed.updateId, skipped: 'user_not_allowed' };
  }

  processedUpdates += 1;
  lastUpdateAt = nowIso();
  await botRepo.update(uid, botId, {
    activity: {
      lastUpdateAt,
      lastExecutionAt: bot.activity?.lastExecutionAt || null,
      updateCount: (bot.activity?.updateCount || 0) + 1,
    },
  }).catch((err) => logger.warn('bot activity update failed', { botId, message: err.message }));

  const matches = await selectWorkflows(uid, botId, parsed);

  let transportClient = client;
  const resolveTransport = async () => {
    if (!transportClient) {
      const resolved = await getBotTelegramClient(uid, botId);
      transportClient = resolved.client;
    }
    return createRetryingTransport(createTelegramTransport(transportClient), { maxAttempts: 2 });
  };

  const executions = [];

  // Static command replies are the fallback when no published workflow owns the
  // command. A workflow trigger always wins, so behaviour stays predictable.
  const workflowOwnsCommand =
    Boolean(parsed.command) &&
    matches.some(
      (match) =>
        match.trigger.type === 'command' && String(match.trigger.config?.command || '').toLowerCase() === parsed.command,
    );
  if (parsed.command && !workflowOwnsCommand) {
    const reply = await deliverCommandReply({ uid, botId, parsed, resolveTransport, executions });
    if (reply) {
      recordRuntimeEvent({ botId, kind: 'command_reply', command: parsed.command, status: reply.status });
    }
  }

  if (matches.length === 0) {
    if (executions.length === 0) {
      recordRuntimeEvent({ botId, kind: 'no_match', updateId: parsed.updateId });
      return { updateId: parsed.updateId, matched: 0, executions: [] };
    }
    return { updateId: parsed.updateId, matched: 0, executions };
  }

  const event = toEngineEvent(parsed);

  for (const match of matches) {
    const outcome = await runWorkflowOnce({
      uid,
      botId,
      workflow: match.workflow,
      graph: match.graph,
      trigger: match.trigger,
      event,
      client: transportClient,
      inputSummary: summarizeText(parsed.callbackData ? `button: ${parsed.callbackData}` : parsed.text, 160),
      idempotencyKey: `${botId}:${parsed.updateId}:${match.workflow.id}`,
    });
    executions.push(outcome.summary);
    if (outcome.status === 'skipped') {
      recordRuntimeEvent({ botId, workflowId: match.workflow.id, kind: outcome.reason || 'skipped' });
    } else {
      recordRuntimeEvent({ botId, workflowId: match.workflow.id, kind: 'executed', status: outcome.status, executionId: outcome.executionId });
    }
  }

  return { updateId: parsed.updateId, matched: matches.length, executions };
}

/**
 * Execute one published workflow once and record the execution.
 *
 * Used by the inbound-update runtime and by the scheduler so both paths share
 * identical cooldown, concurrency, timeout and recording behaviour.
 */
export async function runWorkflowOnce({
  uid,
  botId,
  workflow,
  graph,
  trigger,
  event,
  client = null,
  mode = EXECUTION_MODE.LIVE,
  triggerType = trigger?.type || null,
  inputSummary = null,
  idempotencyKey = null,
}) {
  const cooldown = cooldownRemainingMs(workflow);
  if (cooldown > 0) {
    return { status: 'skipped', reason: 'cooldown', summary: { workflowId: workflow.id, status: 'skipped', reason: 'cooldown' } };
  }
  const running = inFlightByWorkflow.get(workflow.id) || 0;
  if (running > 0 && workflow.settings?.allowConcurrentRuns === false) {
    return {
      status: 'skipped',
      reason: 'concurrent_run_blocked',
      summary: { workflowId: workflow.id, status: 'skipped', reason: 'concurrent_run_blocked' },
    };
  }

  let transport;
  if (client) {
    transport = createRetryingTransport(createTelegramTransport(client), { maxAttempts: 2 });
  } else {
    const resolved = await getBotTelegramClient(uid, botId);
    transport = createRetryingTransport(createTelegramTransport(resolved.client), { maxAttempts: 2 });
  }

  inFlightByWorkflow.set(workflow.id, running + 1);
  const startedAt = nowIso();
  let result;
  try {
    result = await executeWorkflow({
      graph,
      triggerId: trigger.id,
      transport,
      event,
      variables: {},
      timeoutMs: config.runtime.executionTimeoutMs,
      maxSteps: config.runtime.executionMaxSteps,
      allowedHosts: ALLOWED_HOSTS,
    });
  } finally {
    const left = (inFlightByWorkflow.get(workflow.id) || 1) - 1;
    if (left <= 0) inFlightByWorkflow.delete(workflow.id);
    else inFlightByWorkflow.set(workflow.id, left);
  }

  const execution = await executionRepo.create(uid, botId, {
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.publishedVersion ?? null,
    mode,
    triggerType,
    triggerId: trigger.id,
    status: result.status,
    startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    stepCount: result.stepCount,
    steps: result.steps,
    variables: result.variables,
    transcript: result.transcript,
    inputSummary,
    error: result.error,
    idempotencyKey,
    retryCount: transport.retries ? transport.retries() : 0,
    simulated: mode === EXECUTION_MODE.SIMULATION,
  });

  await workflowRepo
    .update(uid, botId, workflow.id, {
      lastRunAt: startedAt,
      runCount: (workflow.runCount || 0) + 1,
    })
    .catch(() => {});
  const bot = await botRepo.get(uid, botId).catch(() => null);
  await botRepo
    .update(uid, botId, {
      activity: {
        lastUpdateAt: bot?.activity?.lastUpdateAt || null,
        lastExecutionAt: nowIso(),
        updateCount: bot?.activity?.updateCount || 0,
      },
    })
    .catch(() => {});

  return {
    status: result.status,
    executionId: execution.id,
    error: result.error,
    summary: {
      executionId: execution.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: result.status,
      error: result.error,
    },
  };
}

/** Send the stored reply for a command, recording it as a live execution. */
async function deliverCommandReply({ uid, botId, parsed, resolveTransport, executions }) {
  const command = await commandRepo.findByName(uid, botId, parsed.command);
  if (!command || command.enabled === false) return null;
  if (!isCommandUserAllowed(command, parsed.user?.id)) {
    recordRuntimeEvent({ botId, kind: 'restricted_command', command: command.name, userId: parsed.user?.id || null });
    return { status: 'skipped', reason: 'user_not_allowed' };
  }

  const startedAt = nowIso();
  const payload = buildCommandReply(command);
  const step = { index: 0, nodeId: command.id, type: 'commandReply', label: `Reply to /${command.name}`, status: 'succeeded', durationMs: 0 };
  const started = Date.now();
  let error = null;

  try {
    const transport = await resolveTransport();
    await transport.sendMessage({
      chat_id: parsed.chat?.id,
      text: payload.text,
      ...(payload.parseMode && payload.parseMode !== 'plain' ? { parse_mode: payload.parseMode } : {}),
      ...(payload.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
      ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
    });
  } catch (err) {
    error = { code: err.code || 'send_failed', message: err.message, nodeId: command.id };
  }

  step.durationMs = Date.now() - started;
  if (error) step.status = 'failed';

  const execution = await executionRepo.create(uid, botId, {
    workflowId: null,
    workflowName: `/${command.name} command reply`,
    workflowVersion: null,
    mode: EXECUTION_MODE.LIVE,
    triggerType: 'command',
    triggerId: null,
    status: error ? EXECUTION_STATUS.FAILED : EXECUTION_STATUS.SUCCEEDED,
    startedAt,
    finishedAt: nowIso(),
    durationMs: step.durationMs,
    stepCount: 1,
    steps: [step],
    variables: {},
    transcript: [
      {
        direction: 'in',
        kind: 'text',
        text: parsed.text || `/${command.name}`,
        at: startedAt,
      },
      ...(error
        ? []
        : [{ direction: 'out', kind: 'text', text: payload.text, keyboard: payload.replyMarkup?.inline_keyboard || [], at: nowIso() }]),
    ],
    inputSummary: summarizeText(parsed.text || `/${command.name}`, 160),
    error,
    idempotencyKey: `${botId}:${parsed.updateId}:command:${command.id}`,
    retryCount: 0,
    simulated: false,
  });

  executions.push({
    executionId: execution.id,
    workflowId: null,
    workflowName: execution.workflowName,
    status: execution.status,
    error,
    source: 'command',
  });
  return { status: execution.status, executionId: execution.id };
}

/* --------------------------------------------------------------------------
 * Queue wiring
 * ------------------------------------------------------------------------ */

export const runtimeQueue = createQueue({
  name: 'live-runtime',
  concurrency: config.runtime.queueConcurrency,
  maxAttempts: 3,
  handler: async (payload) => {
    try {
      const summary = await processUpdate(payload);
      return { result: summary };
    } catch (err) {
      if (err.code === 'rate_limited') {
        return { retry: true, delayMs: (err.retryAfter || 1) * 1000, reason: 'rate_limited' };
      }
      if (err.code === 'network' || err.code === 'timeout') {
        return { retry: true, delayMs: 2000, reason: err.code };
      }
      logger.warn('live runtime job failed', { botId: payload.botId, code: err.code });
      recordRuntimeEvent({ botId: payload.botId, kind: 'failed', code: err.code || 'error' });
      return { retry: false, reason: err.code || 'error' };
    }
  },
});

/** Enqueue an update for background processing. */
export function enqueueUpdate({ uid, botId, update }) {
  return runtimeQueue.enqueue({ uid, botId, update }, { dedupeKey: `${botId}:${update?.update_id}` });
}

/** Runtime health for the UI: queue counters, worker state, recent events. */
export function runtimeStatus() {
  const stats = runtimeQueue.stats();
  return {
    queue: stats,
    worker: {
      state: stats.idle ? 'idle' : 'busy',
      concurrency: stats.concurrency,
      note:
        'The live runtime runs inside the web process with a bounded in-process queue. ' +
        'For horizontal scaling, move this queue to a managed broker.',
    },
    processedUpdates,
    lastUpdateAt,
    recentEvents: runtimeEvents.slice(0, 20),
  };
}

export const __internal = { resetRuntimeStats() { processedUpdates = 0; lastUpdateAt = null; runtimeEvents.length = 0; } };
