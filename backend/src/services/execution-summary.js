import { summarizeText } from '../utils/redact.js';

/** Public, redacted shape of an execution record for API responses. */
export function summarizeExecution(exec) {
  if (!exec) return null;
  return {
    id: exec.id,
    botId: exec.botId,
    workflowId: exec.workflowId || null,
    workflowName: exec.workflowName || null,
    workflowVersion: exec.workflowVersion ?? null,
    triggerType: exec.triggerType || null,
    mode: exec.mode || 'live',
    status: exec.status,
    startedAt: exec.startedAt,
    finishedAt: exec.finishedAt || null,
    durationMs: exec.durationMs ?? null,
    stepCount: exec.stepCount ?? 0,
    retryCount: exec.retryCount ?? 0,
    simulated: exec.simulated === true,
    inputSummary: exec.inputSummary ? summarizeText(exec.inputSummary, 120) : null,
    error: exec.error ? { code: exec.error.code, message: exec.error.message } : null,
  };
}
