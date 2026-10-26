/**
 * Presentational pieces for the virtual Telegram simulator.
 *
 * Everything here is pure rendering of data returned by
 * `POST /bots/:botId/simulate`; the page owns state and event handling.
 */
import { escapeHtml, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

export const STATUS_TONE = {
  succeeded: 'success',
  failed: 'danger',
  timeout: 'warning',
  skipped: 'neutral',
};

export function statusBadge(status) {
  const tone = STATUS_TONE[status] || 'neutral';
  return `<span class="badge badge--${tone}">${escapeHtml(status || 'unknown')}</span>`;
}

function keyboardMarkup(keyboard) {
  const rows = Array.isArray(keyboard) ? keyboard.filter((row) => Array.isArray(row) && row.length > 0) : [];
  if (rows.length === 0) return '';
  return `<div class="sim-keyboard">
    ${rows
      .map(
        (row) =>
          `<div class="sim-keyboard__row">${row
            .map((button) => {
              const data = button.callback_data ?? '';
              const label = button.text ?? 'Button';
              if (!data) {
                return `<span class="sim-keyboard__btn sim-keyboard__btn--static">${escapeHtml(label)}</span>`;
              }
              return `<button class="sim-keyboard__btn" type="button" data-callback="${escapeHtml(
                data,
              )}" title="Simulate tapping this button">${escapeHtml(label)}</button>`;
            })
            .join('')}</div>`,
      )
      .join('')}
  </div>`;
}

/** Renders a Telegram-like conversation bubble list. */
export function renderTranscript(messages = [], { botName = 'Your bot' } = {}) {
  if (!messages.length) {
    return `<div class="sim-empty">${icon('message')}<p class="secondary">No messages yet. Send something to your bot to start the simulation.</p></div>`;
  }
  return `<div class="sim-thread">
    ${messages
      .map((message) => {
        const inbound = message.direction === 'in';
        const label = inbound ? 'You' : botName;
        const body = message.text
          ? `<div class="sim-bubble__text">${escapeHtml(message.text)}</div>`
          : `<div class="sim-bubble__text secondary">${escapeHtml(mediaLabel(message))}</div>`;
        return `<div class="sim-row ${inbound ? 'sim-row--in' : 'sim-row--out'}">
          <div class="sim-bubble ${inbound ? 'sim-bubble--in' : 'sim-bubble--out'}">
            <div class="sim-bubble__meta"><span>${escapeHtml(label)}</span>${message.edited ? '<span class="sim-tag">edited</span>' : ''}</div>
            ${body}
            ${keyboardMarkup(message.keyboard)}
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function mediaLabel(message) {
  switch (message.kind) {
    case 'photo':
      return '[photo]';
    case 'document':
      return '[document]';
    case 'media':
      return '[media]';
    default:
      return '[message]';
  }
}

/** Branch-tracing step timeline. */
export function renderStepTimeline(steps = []) {
  if (!steps.length) {
    return `<div class="empty empty--tight"><p class="secondary">No steps were executed.</p></div>`;
  }
  return `<ol class="sim-steps">
    ${steps
      .map((step) => {
        const branch = step.output?.branch;
        const detail = stepDetail(step);
        return `<li class="sim-step sim-step--${escapeHtml(step.status || 'unknown')}">
          <span class="sim-step__dot" aria-hidden="true"></span>
          <div class="sim-step__body">
            <div class="sim-step__head">
              <span class="sim-step__index">${Number(step.index ?? 0) + 1}</span>
              <span class="sim-step__label">${escapeHtml(step.label || step.type)}</span>
              <span class="sim-step__type">${escapeHtml(step.type)}</span>
              ${branch ? `<span class="sim-branch">branch: ${escapeHtml(branch)}</span>` : ''}
              ${statusBadge(step.status)}
              <span class="sim-step__time">${escapeHtml(String(step.durationMs ?? 0))} ms</span>
            </div>
            ${detail ? `<div class="sim-step__detail">${detail}</div>` : ''}
            ${
              step.error
                ? `<div class="sim-step__error">${icon('alert')} <strong>${escapeHtml(step.error.code || 'error')}</strong> — ${escapeHtml(
                    step.error.message || '',
                  )}</div>`
                : ''
            }
          </div>
        </li>`;
      })
      .join('')}
  </ol>`;
}

function stepDetail(step) {
  const output = step.output || {};
  const parts = [];
  if (typeof output.text === 'string' && output.text) parts.push(escapeHtml(output.text));
  if (output.buttonCount) parts.push(`${output.buttonCount} button(s)`);
  if (output.branch) parts.push(`matched → ${escapeHtml(output.branch)} branch`);
  if (output.reason) parts.push(`ended: ${escapeHtml(output.reason)}`);
  if (output.url) parts.push(escapeHtml(output.url));
  if (typeof output.status === 'number') parts.push(`HTTP ${output.status}`);
  if (output.note) parts.push(escapeHtml(output.note));
  return parts.length ? parts.join(' · ') : '';
}

/** Variables table with an explicit empty state. */
export function renderVariables(variables = {}) {
  const entries = Object.entries(variables || {});
  if (!entries.length) {
    return `<p class="secondary small" style="margin:0">This run did not set any variables.</p>`;
  }
  return `<dl class="kv-list">
    ${entries
      .map(
        ([key, value]) =>
          `<div class="kv-list__row"><dt>${escapeHtml(key)}</dt><dd><code>${escapeHtml(
            typeof value === 'string' ? value : JSON.stringify(value),
          )}</code></dd></div>`,
      )
      .join('')}
  </dl>`;
}

/** Run summary card shown above the timeline. */
export function renderRunSummary(execution, trigger) {
  if (!execution) return '';
  const error = execution.error;
  return `<div class="sim-summary">
    <div class="sim-summary__row">
      ${statusBadge(execution.status)}
      <span class="small">${escapeHtml(String(execution.stepCount ?? 0))} step(s)</span>
      <span class="small">${escapeHtml(String(execution.durationMs ?? 0))} ms</span>
      ${trigger ? `<span class="small">trigger: <code>${escapeHtml(trigger.type)}</code></span>` : ''}
      <span class="small secondary">${escapeHtml(relativeTime(execution.startedAt) || '')}</span>
      <span class="sim-tag sim-tag--warn">simulated</span>
    </div>
    ${
      error
        ? `<div class="alert alert--danger" role="alert">${icon('xCircle')}<div class="alert__body">
            <div class="alert__title">${escapeHtml(error.code || 'execution failed')}</div>
            <div class="alert__text">${escapeHtml(error.message || '')}${
              error.nodeId ? ` <span class="secondary">(step ${escapeHtml(error.nodeId)})</span>` : ''
            }</div>
          </div></div>`
        : ''
    }
  </div>`;
}

/** Renders an error returned by the simulator API (validation, no trigger, …). */
export function renderSimulatorError(error) {
  const details = Array.isArray(error?.details) ? error.details : [];
  return `<div class="alert alert--danger" role="alert">${icon('xCircle')}
    <div class="alert__body">
      <div class="alert__title">${escapeHtml(error?.message || 'The simulation could not run.')}</div>
      ${details.length ? `<ul class="alert__text">${details.map((d) => `<li>${escapeHtml(d.field || d.path || 'workflow')}: ${escapeHtml(d.message || String(d))}</li>`).join('')}</ul>` : ''}
    </div>
  </div>`;
}
