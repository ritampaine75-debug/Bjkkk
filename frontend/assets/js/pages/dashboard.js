/** Overview dashboard: honest aggregates + getting started checklist. */
import { escapeHtml, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { dashboardApi } from '../api-client.js';
import { getState, setState } from '../state.js';
import { skeletonPage, renderPageError } from '../components/states.js';

export default async function mountDashboard(container) {
  container.innerHTML = skeletonPage();
  let summary;
  try {
    summary = await dashboardApi.summary();
  } catch (err) {
    renderPageError(container, { title: 'Could not load your dashboard', message: err.message, retry: () => mountDashboard(container) });
    return;
  }
  setState({ dashboard: summary, bots: summary.bots });

  const user = getState().user;
  const totals = summary.totals;
  const completed = summary.gettingStarted.filter((s) => s.done).length;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">Overview</h1>
          <p class="page-header__subtitle">
            ${escapeHtml(greeting())}${user?.displayName ? `, ${escapeHtml(user.displayName.split(' ')[0])}` : ''}.
            ${totals.bots === 0 ? 'Connect your first bot to get started.' : `You have ${totals.bots} connected bot${totals.bots === 1 ? '' : 's'}.`}
          </p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--primary" href="#/bots/connect">${icon('plus')} Connect bot</a>
        </div>
      </header>

      <div class="grid cols-2" role="list">
        ${statCard('Connected bots', totals.bots, 'bot', totals.bots === 0 ? 'No bots yet' : `${summary.bots.filter((b) => b.connectionState === 'connected').length} validated`)}
        ${statCard('Active workflows', totals.activeWorkflows, 'workflow', `${totals.totalWorkflows} total`)}
        ${statCard('Executions', totals.executions, 'activity', 'All time')}
        ${statCard('Failed executions', totals.failedExecutions, 'alert', totals.failedExecutions > 0 ? 'Review the logs' : 'None recorded')}
      </div>

      ${
        completed < summary.gettingStarted.length
          ? `<section class="card">
              <div class="card__header">
                <div>
                  <h2 class="card__title">${icon('checkCircle')} Getting started</h2>
                  <p class="card__subtitle">${completed} of ${summary.gettingStarted.length} steps complete</p>
                </div>
              </div>
              <div class="card__body stack" style="gap:var(--space-3)">
                <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${summary.gettingStarted.length}"
                  aria-valuenow="${completed}" aria-label="Setup progress">
                  <div class="progress__bar" style="width:${Math.round((completed / summary.gettingStarted.length) * 100)}%"></div>
                </div>
                <ul class="list" style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden">
                  ${summary.gettingStarted.map(checklistItem).join('')}
                </ul>
              </div>
            </section>`
          : ''
      }

      <div class="split-2">
        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">Recent executions</h2>
              <p class="card__subtitle">Workflow runs recorded by the runtime</p>
            </div>
            <a class="btn btn--ghost btn--sm" href="#/bots">${icon('arrowRight')} All bots</a>
          </div>
          <div class="card__body card__body--flush">
            ${
              summary.recentExecutions.length === 0
                ? emptyBlock('activity', 'No executions yet', 'Executions appear here once a workflow runs in the simulator or live runtime.')
                : `<div class="list">${summary.recentExecutions.map(executionRow).join('')}</div>`
            }
          </div>
        </section>

        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">Your bots</h2>
              <p class="card__subtitle">Safe metadata reported by Telegram</p>
            </div>
          </div>
          <div class="card__body card__body--flush">
            ${
              summary.bots.length === 0
                ? emptyBlock('bot', 'No bots connected', 'Add a BotFather token to create your first bot workspace.', [
                    { label: 'Connect bot', href: '#/bots/connect', primary: true },
                  ])
                : `<div class="list">${summary.bots.map(botRow).join('')}</div>`
            }
          </div>
        </section>
      </div>

      ${
        summary.recentFailures.length > 0
          ? `<section class="card">
              <div class="card__header"><h2 class="card__title">${icon('alert')} Needs attention</h2></div>
              <div class="card__body stack-sm">
                ${summary.recentFailures
                  .map(
                    (f) => `<div class="alert alert--danger">
                      ${icon('xCircle')}
                      <div class="alert__body">
                        <div class="alert__title">${escapeHtml(f.workflowName || f.workflowId || 'Execution')} failed</div>
                        <div class="alert__text">${escapeHtml(f.error?.message || 'No error summary recorded.')} · ${escapeHtml(relativeTime(f.startedAt))}</div>
                      </div>
                    </div>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }
    </div>`;

  container.querySelectorAll('[data-exec-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const botId = el.dataset.botId;
      window.location.hash = `#/bots/${encodeURIComponent(botId)}/executions`;
    });
  });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function statCard(label, value, iconName, meta) {
  return `<div class="stat" role="listitem">
    <span class="stat__label">${icon(iconName)} ${escapeHtml(label)}</span>
    <span class="stat__value">${escapeHtml(String(value))}</span>
    <span class="stat__meta">${escapeHtml(meta)}</span>
  </div>`;
}

function checklistItem(step) {
  return `<li class="list__item">
    <span style="flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;
      background:${step.done ? 'var(--success-soft)' : 'var(--bg-sunken)'};color:${step.done ? 'var(--success)' : 'var(--text-muted)'}">
      ${icon(step.done ? 'check' : 'chevronRight', { size: 14 })}
    </span>
    <span class="list__main">
      <span class="list__title"${step.done ? ' style="text-decoration:line-through;color:var(--text-muted)"' : ''}>${escapeHtml(step.label)}</span>
      <span class="list__meta">${escapeHtml(step.hint || '')}</span>
    </span>
  </li>`;
}

function executionRow(exec) {
  const tone = exec.status === 'succeeded' ? 'success' : exec.status === 'failed' ? 'danger' : exec.status === 'running' ? 'brand' : 'neutral';
  return `<button class="list__item" type="button" data-exec-id="${escapeHtml(exec.id)}" data-bot-id="${escapeHtml(exec.botId)}"
    style="width:100%;text-align:left;background:none;border-left:none;border-right:none;border-top:none">
    <span class="list__main">
      <span class="list__title">${escapeHtml(exec.workflowName || 'Untitled workflow')}</span>
      <span class="list__meta">
        <span class="badge badge--${tone}">${escapeHtml(exec.status)}</span>
        <span>${escapeHtml(exec.mode)}</span>
        <span>${escapeHtml(relativeTime(exec.startedAt))}</span>
      </span>
    </span>
    ${icon('chevronRight')}
  </button>`;
}

function botRow(bot) {
  const stateTone =
    bot.connectionState === 'connected' ? 'success' : bot.connectionState === 'revoked' ? 'neutral' : 'warning';
  return `<a class="list__item" href="#/bots/${encodeURIComponent(bot.id)}" style="text-decoration:none;color:inherit">
    <span class="list__main">
      <span class="list__title">${escapeHtml(bot.displayName || bot.username || 'Bot')}${bot.username ? ` <span class="muted small">@${escapeHtml(bot.username)}</span>` : ''}</span>
      <span class="list__meta">
        <span class="badge badge--${stateTone} badge--dot">${escapeHtml(bot.connectionState.replace(/_/g, ' '))}</span>
        <span>${escapeHtml(bot.environment)}</span>
      </span>
    </span>
    ${icon('chevronRight')}
  </a>`;
}

function emptyBlock(iconName, title, description, actions = []) {
  return `<div class="empty">
    <div class="empty__icon">${icon(iconName)}</div>
    <h3>${escapeHtml(title)}</h3>
    <p class="secondary">${escapeHtml(description)}</p>
    ${
      actions.length
        ? `<div class="empty__actions">${actions
            .map((a) => `<a class="btn ${a.primary ? 'btn--primary' : 'btn--secondary'} btn--sm" href="${a.href}">${escapeHtml(a.label)}</a>`)
            .join('')}</div>`
        : ''
    }
  </div>`;
}
