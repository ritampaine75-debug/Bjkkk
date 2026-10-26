/**
 * Execution log browser: filterable list plus a full detail view including
 * the step timeline and the simulated conversation transcript.
 */
import { escapeHtml, relativeTime, formatDate, formatDuration } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { loadBot } from '../services/bot-context.js';
import { renderBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { renderStepTimeline, renderTranscript, renderVariables, statusBadge } from '../components/workflow-simulator.js';
import { confirmDialog } from '../components/modal.js';
import { api } from '../api-client.js';
import { toastSuccess, toastError } from '../components/toast.js';

const STATUS_FILTERS = ['', 'succeeded', 'failed', 'timeout', 'skipped'];

export default async function mountExecutions(container, { params, query = {} }) {
  container.innerHTML = skeletonPage();
  let bot;
  try {
    const data = await loadBot(params.botId);
    bot = data.bot;
  } catch (err) {
    renderPageError(container, {
      title: 'Could not load execution logs',
      message: err.message,
      retry: () => mountExecutions(container, { params, query }),
    });
    return;
  }

  const state = {
    status: STATUS_FILTERS.includes(query.status) ? query.status : '',
    executions: [],
    pagination: { offset: 0, limit: 25, hasMore: false, nextOffset: null },
    loading: false,
  };

  container.innerHTML = `<div class="page">
    ${renderBotHeader(bot, 'executions')}
    <section class="card" id="analytics-card">
      <div class="card__header">
        <div>
          <h2 class="card__title">${icon('activity')} Analytics</h2>
          <p class="card__subtitle">Last 14 days, computed from stored executions</p>
        </div>
        <select class="select select--sm" id="analytics-days" aria-label="Analytics window">
          <option value="7">7 days</option>
          <option value="14" selected>14 days</option>
          <option value="30">30 days</option>
        </select>
      </div>
      <div class="card__body" id="analytics-body"><div class="skeleton skeleton--block"></div></div>
    </section>

    <section class="card">
      <div class="card__header">
        <div>
          <h2 class="card__title">${icon('logs')} Execution logs</h2>
          <p class="card__subtitle">Simulated and live runs, newest first. Transcripts are kept for a limited retention window.</p>
        </div>
        <div class="row row--wrap">
          <select class="select select--sm" id="exec-filter" aria-label="Filter by status">
            ${STATUS_FILTERS.map(
              (value) => `<option value="${value}"${value === state.status ? ' selected' : ''}>${value || 'All statuses'}</option>`,
            ).join('')}
          </select>
          <button class="btn btn--secondary btn--sm" type="button" id="exec-refresh">${icon('refresh')} Refresh</button>
        </div>
      </div>
      <div class="card__body" id="exec-list"></div>
      <div class="card__footer" id="exec-more" hidden>
        <button class="btn btn--secondary btn--sm" type="button" id="exec-load-more">Load more</button>
      </div>
    </section>
  </div>`;

  const analyticsBody = container.querySelector('#analytics-body');
  const analyticsDays = container.querySelector('#analytics-days');

  function stat(label, value, meta = '') {
    return `<div class="stat">
      <span class="stat__label">${escapeHtml(label)}</span>
      <span class="stat__value">${escapeHtml(String(value))}</span>
      ${meta ? `<span class="stat__meta">${escapeHtml(meta)}</span>` : ''}
    </div>`;
  }

  function paintAnalytics(analytics) {
    if (!analytics) {
      analyticsBody.innerHTML = `<p class="secondary small" style="margin:0">Analytics unavailable.</p>`;
      return;
    }
    if (analytics.totals.runs === 0) {
      analyticsBody.innerHTML = `<div class="empty">${icon('activity')}
        <h3>No executions in this window</h3>
        <p class="secondary">Analytics appear as soon as workflows run. Nothing is estimated.</p>
      </div>`;
      return;
    }
    const max = Math.max(...analytics.daily.map((day) => day.total), 1);
    analyticsBody.innerHTML = `
      <div class="grid cols-2" style="margin-bottom:var(--space-3)">
        ${stat('Runs', analytics.totals.runs, `${analytics.totals.succeeded} succeeded · ${analytics.totals.failed} failed · ${analytics.totals.timeout} timed out`)}
        ${stat('Success rate', analytics.totals.successRate === null ? '—' : `${analytics.totals.successRate}%`, `${analytics.totals.modes.live} live · ${analytics.totals.modes.simulation} simulated`)}
        ${stat('Median duration', analytics.duration.p50Ms === null ? '—' : formatDuration(analytics.duration.p50Ms), `p95 ${analytics.duration.p95Ms === null ? '—' : formatDuration(analytics.duration.p95Ms)}`)}
        ${stat('Slowest run', analytics.duration.slowestMs === null ? '—' : formatDuration(analytics.duration.slowestMs), analytics.window.truncated ? 'sampled from newest runs' : '')}
      </div>
      <div class="analytics-chart" role="img" aria-label="Executions per day">
        ${analytics.daily
          .map(
            (day) => `<div class="analytics-bar" title="${escapeHtml(day.date)}: ${day.total} run(s), ${day.failed} failed">
              <span class="analytics-bar__fill" style="height:${Math.round((day.total / max) * 100)}%"></span>
            </div>`,
          )
          .join('')}
      </div>
      <p class="field__hint" style="margin-top:var(--space-2)">Daily runs over the last ${analytics.window.days} days.</p>
      <div class="table-wrap" style="margin-top:var(--space-3)"><table class="table table--compact">
        <thead><tr><th>Workflow</th><th>Runs</th><th>Failures</th><th>Avg</th><th>Last run</th></tr></thead>
        <tbody>
          ${analytics.workflows
            .slice(0, 8)
            .map(
              (row) => `<tr>
                <td>${escapeHtml(row.workflowName)}</td>
                <td>${row.runs}</td>
                <td>${row.failures}</td>
                <td>${row.averageMs === null ? '—' : escapeHtml(formatDuration(row.averageMs))}</td>
                <td>${escapeHtml(row.lastRunAt ? relativeTime(row.lastRunAt) : '—')} ${statusBadge(row.lastStatus || 'unknown')}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table></div>
      ${
        analytics.errors.length
          ? `<p class="small secondary" style="margin:var(--space-3) 0 0">Top errors: ${analytics.errors
              .map((error) => `<code>${escapeHtml(error.code)}</code> ×${error.count}`)
              .join(' · ')}</p>`
          : ''
      }`;
  }

  async function loadAnalytics() {
    try {
      const res = await api.get(
        `/bots/${encodeURIComponent(bot.id)}/analytics?days=${encodeURIComponent(analyticsDays.value)}`,
      );
      paintAnalytics(res.analytics);
    } catch (err) {
      analyticsBody.innerHTML = `<p class="secondary small" style="margin:0">${escapeHtml(err.message)}</p>`;
    }
  }

  analyticsDays.addEventListener('change', loadAnalytics);

  const listEl = container.querySelector('#exec-list');
  const moreEl = container.querySelector('#exec-more');
  const filterEl = container.querySelector('#exec-filter');

  function paint() {
    if (state.loading && state.executions.length === 0) {
      listEl.innerHTML = `<div class="skeleton skeleton--row"></div><div class="skeleton skeleton--row"></div>`;
      return;
    }
    if (state.executions.length === 0) {
      listEl.innerHTML = `<div class="empty">${icon('logs')}
        <h3>No executions${state.status ? ` with status ${escapeHtml(state.status)}` : ''}</h3>
        <p class="secondary">Run a workflow in the simulator and it will show up here.</p>
        <div class="empty__actions"><a class="btn btn--secondary" href="#/bots/${encodeURIComponent(bot.id)}/simulator">${icon('flask')} Open simulator</a></div>
      </div>`;
      moreEl.hidden = true;
      return;
    }
    listEl.innerHTML = `<ul class="exec-list">
      ${state.executions
        .map(
          (execution) => `<li class="exec-row">
          <button class="exec-row__main" type="button" data-execution="${escapeHtml(execution.id)}">
            <span class="exec-row__status">${statusBadge(execution.status)}</span>
            <span class="exec-row__body">
              <span class="exec-row__title">${escapeHtml(execution.workflowName || 'Unknown workflow')}</span>
              <span class="exec-row__meta secondary small">
                ${escapeHtml(execution.triggerType || 'trigger')} ·
                ${escapeHtml(String(execution.stepCount ?? 0))} steps ·
                ${escapeHtml(formatDuration(execution.durationMs) || '—')} ·
                ${escapeHtml(relativeTime(execution.startedAt))}
              </span>
            </span>
            <span class="exec-row__tags">
              ${
                execution.mode === 'simulation'
                  ? '<span class="sim-tag sim-tag--warn">simulated</span>'
                  : '<span class="sim-tag">live</span>'
              }
              ${execution.error ? `<span class="badge badge--danger">${escapeHtml(execution.error.code || 'error')}</span>` : ''}
            </span>
            ${icon('chevronRight')}
          </button>
        </li>`,
        )
        .join('')}
    </ul>`;
    moreEl.hidden = !state.pagination.hasMore;
  }

  async function load({ append = false } = {}) {
    state.loading = true;
    paint();
    const offset = append ? state.pagination.nextOffset ?? state.executions.length : 0;
    const params_ = new URLSearchParams({ limit: '25', offset: String(offset) });
    if (state.status) params_.set('status', state.status);
    try {
      const res = await api.get(`/bots/${encodeURIComponent(bot.id)}/executions?${params_.toString()}`);
      state.executions = append ? [...state.executions, ...res.executions] : res.executions;
      state.pagination = res.pagination;
    } catch (err) {
      toastError(err.message);
    } finally {
      state.loading = false;
      paint();
    }
  }

  async function openDetail(executionId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal modal--wide';
    dialog.innerHTML = `<div class="modal__header">
      <div><h2 class="card__title">Execution detail</h2><p class="card__subtitle">Loading…</p></div>
      <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="modal__body" id="exec-detail"><div class="skeleton skeleton--block"></div></div>
    <div class="modal__footer">
      <button class="btn btn--ghost btn--sm" type="button" id="exec-delete">${icon('trash')} Delete log</button>
      <button class="btn btn--secondary" type="button" data-close>Close</button>
    </div>`;
    document.body.appendChild(dialog);
    const close = () => {
      if (typeof dialog.close === 'function') dialog.close();
      dialog.remove();
    };
    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
    dialog.addEventListener('cancel', () => dialog.remove());
    if (typeof dialog.showModal === 'function') dialog.showModal();

    try {
      const res = await api.get(`/bots/${encodeURIComponent(bot.id)}/executions/${encodeURIComponent(executionId)}`);
      const execution = res.execution;
      dialog.querySelector('.card__subtitle').textContent = `${execution.workflowName || 'Workflow'} · ${formatDate(execution.startedAt)}`;
      dialog.querySelector('#exec-detail').innerHTML = `<div class="stack">
        <div class="row row--wrap">
          ${statusBadge(execution.status)}
          <span class="small">${escapeHtml(String(execution.stepCount ?? 0))} step(s)</span>
          <span class="small">${escapeHtml(formatDuration(execution.durationMs) || '—')}</span>
          <span class="small secondary">${escapeHtml(execution.triggerType || '')}</span>
          <span class="sim-tag ${execution.simulated ? 'sim-tag--warn' : ''}">${execution.simulated ? 'simulated' : 'live'}</span>
        </div>
        ${
          execution.error
            ? `<div class="alert alert--danger">${icon('xCircle')}<div class="alert__body">
                <div class="alert__title">${escapeHtml(execution.error.code || 'error')}</div>
                <div class="alert__text">${escapeHtml(execution.error.message || '')}</div>
              </div></div>`
            : ''
        }
        <h3 class="section-title">Steps</h3>
        ${renderStepTimeline(execution.steps || [])}
        <h3 class="section-title">Conversation</h3>
        ${renderTranscript(execution.transcript || [], { botName: execution.workflowName || 'Your bot' })}
        <h3 class="section-title">Variables</h3>
        ${renderVariables(execution.variables || {})}
      </div>`;

      dialog.querySelector('#exec-delete').addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'Delete this log entry?',
          message: 'The execution record and its transcript will be removed permanently.',
          confirmLabel: 'Delete',
          tone: 'danger',
        });
        if (!confirmed) return;
        try {
          await api.delete(`/bots/${encodeURIComponent(bot.id)}/executions/${encodeURIComponent(executionId)}`, { confirm: true });
          toastSuccess('Log entry deleted.');
          close();
          state.executions = state.executions.filter((row) => row.id !== executionId);
          paint();
        } catch (err) {
          toastError(err.message);
        }
      });
    } catch (err) {
      dialog.querySelector('#exec-detail').innerHTML = `<div class="alert alert--danger">${icon('xCircle')}
        <div class="alert__body"><div class="alert__title">Could not load this execution</div>
        <div class="alert__text">${escapeHtml(err.message)}</div></div></div>`;
    }
  }

  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-execution]');
    if (row) openDetail(row.dataset.execution);
  });
  filterEl.addEventListener('change', () => {
    state.status = filterEl.value;
    state.executions = [];
    state.pagination = { offset: 0, limit: 25, hasMore: false, nextOffset: null };
    load();
  });
  container.querySelector('#exec-refresh').addEventListener('click', () => load());
  container.querySelector('#exec-load-more').addEventListener('click', () => load({ append: true }));

  await Promise.all([load(), loadAnalytics()]);
}
