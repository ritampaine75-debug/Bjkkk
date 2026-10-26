/**
 * Workflow interpreter.
 *
 * The engine is transport agnostic: the simulator passes a mock transport, the
 * live runtime passes the real Telegram client. The same code path therefore
 * executes both, which is what makes simulation trustworthy.
 *
 * Safety properties:
 *  - bounded steps (MAX_STEPS), depth and wall-clock timeout;
 *  - graphs are validated before execution (loops rejected by the schema);
 *  - a visited set additionally guarantees each node runs at most once;
 *  - no eval, no dynamic imports, no filesystem access from workflow data;
 *  - outbound HTTP actions are HTTPS-only, host allowlisted and SSRF screened.
 */
import { NODE_DEFINITIONS, defaultConfigFor } from '../../../shared/workflow-schema.js';
import { toTelegramReplyMarkup } from '../../../shared/command-schema.js';
import { WORKFLOW_LIMITS, EXECUTION_STATUS } from '../../../shared/constants.js';
import { buildEvaluationContext, interpolate, evaluateCondition, interpolateDeep } from './expression.js';
import { newId, nowIso } from '../utils/ids.js';
import { summarizeText } from '../utils/redact.js';
import { logger } from '../utils/logger.js';

export class WorkflowExecutionError extends Error {
  constructor(message, { code = 'execution_error', nodeId = null } = {}) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
    this.nodeId = nodeId;
  }
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local + cloud metadata
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\./i,
];

export function assertSafeHttpUrl(rawUrl, { allowedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new WorkflowExecutionError('The HTTP action URL is not valid.', { code: 'invalid_url' });
  }
  if (url.protocol !== 'https:') {
    throw new WorkflowExecutionError('HTTP actions may only call HTTPS URLs.', { code: 'insecure_url' });
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new WorkflowExecutionError('HTTP actions cannot call private or link-local addresses.', {
      code: 'blocked_host',
    });
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    throw new WorkflowExecutionError(`Host "${host}" is not in the configured allowlist.`, { code: 'host_not_allowed' });
  }
  return url;
}

/**
 * Execute a workflow graph.
 *
 * @param {object} options
 * @param {object} options.graph          validated workflow graph
 * @param {string} options.triggerId      trigger that fired
 * @param {object} options.transport      transport adapter (mock or Telegram)
 * @param {object} options.event          incoming Telegram-like event
 * @param {object} [options.variables]    initial variables
 * @param {number} [options.maxSteps]
 * @param {number} [options.timeoutMs]
 * @param {(step: object) => void} [options.onStep]
 */
export async function executeWorkflow({
  graph,
  triggerId,
  transport,
  event = {},
  variables = {},
  maxSteps = WORKFLOW_LIMITS.MAX_STEPS,
  timeoutMs = 15000,
  allowedHosts = [],
  now = () => Date.now(),
  onStep = null,
}) {
  const startedAt = nowIso();
  const startedMs = now();
  const deadline = startedMs + timeoutMs;
  const executionId = newId('exec');
  const steps = [];
  const context = buildEvaluationContext({ event, variables: { ...(graph.variables || {}), ...variables } });
  const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const edges = graph.edges || [];
  const executed = new Set();
  let stepCount = 0;
  let failure = null;
  let ended = false;

  const outgoing = (fromId) => edges.filter((edge) => edge.from === fromId);

  const recordStep = (node, status, extra = {}) => {
    const step = {
      index: steps.length + 1,
      nodeId: node.id,
      type: node.type,
      label: NODE_DEFINITIONS[node.type]?.label || node.type,
      status,
      startedAt: nowIso(),
      ...extra,
    };
    steps.push(step);
    onStep?.(step);
    return step;
  };

  async function runNode(node) {
    stepCount += 1;
    if (stepCount > maxSteps) {
      throw new WorkflowExecutionError(`Execution stopped after ${maxSteps} steps.`, { code: 'step_limit', nodeId: node.id });
    }
    if (now() > deadline) {
      throw new WorkflowExecutionError('Execution exceeded its time limit.', { code: 'timeout', nodeId: node.id });
    }
    if (executed.has(node.id)) {
      // Converging branches: run each node once per execution.
      return { status: EXECUTION_STATUS.SKIPPED, skipped: true };
    }
    executed.add(node.id);

    const config = { ...defaultConfigFor(node.type), ...(node.config || {}) };
    const nodeStarted = now();

    try {
    switch (node.type) {
      case 'sendMessage': {
        const text = interpolate(config.text, context);
        const result = await transport.sendMessage({
          chat_id: context.chatId,
          text,
          ...(config.parseMode && config.parseMode !== 'plain' ? { parse_mode: config.parseMode } : {}),
          ...(config.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { messageId: result?.messageId ?? null, text: summarizeText(text, 80) } };
      }
      case 'sendKeyboard': {
        const text = interpolate(config.text, context);
        const replyMarkup = toTelegramReplyMarkup(config.keyboard);
        const result = await transport.sendKeyboard({
          chat_id: context.chatId,
          text,
          ...(config.parseMode && config.parseMode !== 'plain' ? { parse_mode: config.parseMode } : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        return {
          status: 'succeeded',
          durationMs: now() - nodeStarted,
          output: {
            messageId: result?.messageId ?? null,
            buttonCount: (config.keyboard?.rows || []).flat().length,
            text: summarizeText(text, 80),
          },
        };
      }
      case 'sendPhoto': {
        const result = await transport.sendPhoto({
          chat_id: context.chatId,
          photo: config.photo,
          ...(config.caption ? { caption: interpolate(config.caption, context) } : {}),
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { messageId: result?.messageId ?? null } };
      }
      case 'sendDocument': {
        const result = await transport.sendDocument({
          chat_id: context.chatId,
          document: config.document,
          ...(config.caption ? { caption: interpolate(config.caption, context) } : {}),
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { messageId: result?.messageId ?? null } };
      }
      case 'sendMedia': {
        const result = await transport.sendMedia({
          chat_id: context.chatId,
          mediaType: config.mediaType,
          payload: {
            chat_id: context.chatId,
            [config.mediaType]: config.file,
            ...(config.caption ? { caption: interpolate(config.caption, context) } : {}),
          },
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { messageId: result?.messageId ?? null } };
      }
      case 'editMessage': {
        const messageId = context.messageId || (typeof transport.lastMessageId === 'function' ? transport.lastMessageId() : null);
        if (!messageId) {
          throw new WorkflowExecutionError('There is no message to edit yet.', { code: 'nothing_to_edit', nodeId: node.id });
        }
        await transport.editMessage({
          chat_id: context.chatId,
          message_id: Number(messageId),
          text: interpolate(config.text, context),
          ...(config.parseMode && config.parseMode !== 'plain' ? { parse_mode: config.parseMode } : {}),
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { messageId } };
      }
      case 'answerCallback': {
        await transport.answerCallback({
          callback_query_id: context.callbackQueryId || 'simulated',
          ...(config.text ? { text: interpolate(config.text, context) } : {}),
          show_alert: config.showAlert === true,
        });
        return { status: 'succeeded', durationMs: now() - nodeStarted };
      }
      case 'setVariable': {
        context.variables[config.name] = interpolate(config.value, context);
        return {
          status: 'succeeded',
          durationMs: now() - nodeStarted,
          output: { name: config.name, value: summarizeText(context.variables[config.name], 60) },
        };
      }
      case 'delay': {
        const ms = Math.min(Math.max(0, Number(config.ms) || 0), WORKFLOW_LIMITS.DELAY_MAX_MS);
        if (ms > 0) {
          // Delays are honoured but capped by the overall deadline.
          const remaining = deadline - now();
          if (ms > remaining) {
            throw new WorkflowExecutionError('The delay would exceed the execution time limit.', { code: 'timeout', nodeId: node.id });
          }
          await new Promise((resolve) => setTimeout(resolve, ms));
        }
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { waitedMs: ms } };
      }
      case 'httpRequest': {
        const url = assertSafeHttpUrl(interpolate(config.url, context), { allowedHosts });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), WORKFLOW_LIMITS.HTTP_TIMEOUT_MS);
        try {
          const body =
            config.method === 'POST'
              ? config.body
                ? JSON.stringify(interpolateDeep(safeJson(config.body), context))
                : undefined
              : undefined;
          const response = await fetch(url, {
            method: config.method,
            headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body,
            signal: controller.signal,
            redirect: 'manual',
          });
          const text = await response.text();
          return {
            status: 'succeeded',
            durationMs: now() - nodeStarted,
            output: { status: response.status, bytes: Math.min(text.length, WORKFLOW_LIMITS.HTTP_RESPONSE_BYTES) },
          };
        } catch (err) {
          if (err.name === 'AbortError') {
            throw new WorkflowExecutionError('The HTTP action timed out.', { code: 'http_timeout', nodeId: node.id });
          }
          throw new WorkflowExecutionError('The HTTP action could not be completed.', { code: 'http_error', nodeId: node.id });
        } finally {
          clearTimeout(timer);
        }
      }
      case 'logEvent': {
        return {
          status: 'succeeded',
          durationMs: now() - nodeStarted,
          output: { message: summarizeText(interpolate(config.message, context), 200) },
        };
      }
      case 'condition': {
        const result = evaluateCondition(config, context);
        return {
          status: 'succeeded',
          durationMs: now() - nodeStarted,
          output: { branch: result ? 'true' : 'false' },
        };
      }
      case 'end': {
        ended = true;
        return { status: 'succeeded', durationMs: now() - nodeStarted, output: { reason: config.reason || 'completed' } };
      }
      default:
        throw new WorkflowExecutionError(`Unsupported node type: ${node.type}`, { code: 'unsupported_node', nodeId: node.id });
    }
    } catch (err) {
      // Attach the node id so the execution record shows where it failed.
      if (err instanceof WorkflowExecutionError) {
        if (!err.nodeId) err.nodeId = node.id;
        throw err;
      }
      throw new WorkflowExecutionError(err.message || 'This step failed.', {
        code: err.code || 'step_failed',
        nodeId: node.id,
      });
    }
  }

  let status = EXECUTION_STATUS.SUCCEEDED;
  let current = outgoing(triggerId)[0];

  try {
    if (!current) {
      throw new WorkflowExecutionError('The trigger has no connected steps.', { code: 'no_steps' });
    }
    let node = nodesById.get(current.to);
    let guard = 0;
    while (node && guard < WORKFLOW_LIMITS.MAX_NODES + 5) {
      guard += 1;
      if (!NODE_DEFINITIONS[node.type]) {
        throw new WorkflowExecutionError(`Unsupported node type: ${node.type}`, { code: 'unsupported_node', nodeId: node.id });
      }
      const outcome = await runNode(node);
      const step = recordStep(node, outcome.status, {
        durationMs: outcome.durationMs ?? 0,
        ...(outcome.output ? { output: outcome.output } : {}),
        ...(outcome.skipped ? { note: 'Skipped: already executed in this run.' } : {}),
      });
      if (outcome.skipped) {
        // Re-join: continue to the next node after the skipped one.
        const next = outgoing(node.id)[0];
        node = next ? nodesById.get(next.to) : null;
        continue;
      }
      if (ended || node.type === 'end') break;
      if (node.type === 'condition') {
        const label = outcome.output.branch;
        step.output = { ...step.output, label };
        const nextEdge = outgoing(node.id).find((edge) => edge.label === label);
        node = nextEdge ? nodesById.get(nextEdge.to) : null;
        continue;
      }
      const nextEdge = outgoing(node.id)[0];
      node = nextEdge ? nodesById.get(nextEdge.to) : null;
    }
    if (guard >= WORKFLOW_LIMITS.MAX_NODES + 5) {
      throw new WorkflowExecutionError('The execution graph exceeded the node limit.', { code: 'graph_limit' });
    }
  } catch (err) {
    status = err.code === 'timeout' || err.code === 'step_limit' ? EXECUTION_STATUS.TIMEOUT : EXECUTION_STATUS.FAILED;
    failure = {
      code: err.code || 'execution_error',
      message: err.message,
      nodeId: err.nodeId || null,
    };
    if (err.nodeId) {
      const node = nodesById.get(err.nodeId);
      recordStep(node || { id: err.nodeId, type: 'unknown' }, 'failed', { error: failure });
    }
    logger.warn('workflow execution failed', { executionId, code: failure.code });
  }

  const finishedAt = nowIso();
  return {
    executionId,
    status,
    startedAt,
    finishedAt,
    durationMs: now() - startedMs,
    stepCount: steps.length,
    steps,
    variables: { ...context.variables },
    transcript: typeof transport.transcript === 'function' ? transport.transcript() : [],
    error: failure,
    triggerId,
    mode: transport.kind === 'mock' ? 'simulation' : 'live',
  };
}

function safeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
