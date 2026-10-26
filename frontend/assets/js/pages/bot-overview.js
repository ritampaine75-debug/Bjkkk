/** Bot workspace overview: metadata, connection state and quick actions. */
import { escapeHtml, relativeTime, formatDate } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { loadBot, botStateMessage } from '../services/bot-context.js';
import { renderBotHeader, bindBotHeader, stateBadge } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { api } from '../api-client.js';
import { toastSuccess, toastError } from '../components/toast.js';

export default async function mountBotOverview(container, { params }) {
  container.innerHTML = skeletonPage();
  let data;
  try {
    data = await loadBot(params.botId);
  } catch (err) {
    renderPageError(container, { title: 'Could not load this bot', message: err.message, retry: () => mountBotOverview(container, { params }) });
    return;
  }
  const bot = data.bot;
  const notice = botStateMessage(bot);

  container.innerHTML = `
    <div class="page">
      ${renderBotHeader(bot, 'overview')}

      ${notice ? `<div class="alert alert--${notice.tone === 'neutral' ? 'info' : notice.tone}">
        ${icon(notice.tone === 'danger' ? 'xCircle' : 'alert')}
        <div class="alert__body">
          <div class="alert__title">${escapeHtml(notice.title)}</div>
          <div class="alert__text">${escapeHtml(notice.text)}</div>
          <div class="row" style="margin-top:var(--space-2)">
            <a class="btn btn--secondary btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/settings">Open bot settings</a>
          </div>
        </div>
      </div>` : ''}

      <div class="grid cols-2">
        <div class="stat">
          <span class="stat__label">${icon('workflow')} Workflows</span>
          <span class="stat__value">${data.counts.workflows}</span>
          <span class="stat__meta">${data.counts.publishedWorkflows} published</span>
        </div>
        <div class="stat">
          <span class="stat__label">${icon('activity')} Executions</span>
          <span class="stat__value">${data.counts.executions}</span>
          <span class="stat__meta">${data.counts.failedExecutions} failed</span>
        </div>
      </div>

      <div class="split-2">
        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">${icon('bot')} Bot profile</h2>
              <p class="card__subtitle">Detected through Telegram's Bot API</p>
            </div>
          </div>
          <div class="card__body">
            <dl class="stack-sm small" style="margin:0">
              ${row('Display name', bot.displayName)}
              ${row('Telegram username', bot.telegram.username ? `@${bot.telegram.username}` : 'Not reported')}
              ${row('Telegram bot ID', bot.telegram.id || 'Unknown', true)}
              ${row('First name', bot.telegram.firstName || 'Not reported')}
              ${row('Can join groups', yesNo(bot.telegram.canJoinGroups))}
              ${row('Reads all group messages', yesNo(bot.telegram.canReadAllGroupMessages))}
              ${row('Inline queries', yesNo(bot.telegram.supportsInlineQueries))}
              ${row('Environment', bot.environment, false, true)}
            </dl>
            <p class="field__hint" style="margin-top:var(--space-3)">
              Bot description, about text and BotFather-only options are not exposed by the Bot API and are
              therefore not displayed here.
            </p>
          </div>
        </section>

        <div class="stack">
          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('link')} Connection</h2></div>
            <div class="card__body">
              <dl class="stack-sm small" style="margin:0">
                <div class="row-between"><dt class="muted">State</dt><dd style="margin:0">${stateBadge(bot.connection.state)}</dd></div>
                ${row('Last API check', bot.connection.lastCheckedAt ? relativeTime(bot.connection.lastCheckedAt) : 'never')}
                ${row('Token', bot.tokenMask || 'not stored', true)}
                ${row('Webhook', bot.webhook.state.replace(/_/g, ' '))}
                ${row('Connected', formatDate(bot.createdAt, { withTime: false }))}
              </dl>
              ${bot.connection.lastError ? `<div class="alert alert--danger small" style="margin-top:var(--space-3)">
                ${icon('alert')}
                <div class="alert__body"><div class="alert__text">${escapeHtml(bot.connection.lastError.message || '')}</div></div>
              </div>` : ''}
              <div class="row" style="margin-top:var(--space-3)">
                <button class="btn btn--secondary btn--sm" type="button" id="revalidate">${icon('refresh')} Revalidate token</button>
                <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/executions">${icon('logs')} Execution log</a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;

  bindBotHeader(container, {
    bot,
    onRefresh: async () => {
      await api.post(`/bots/${encodeURIComponent(bot.id)}/validate`);
      toastSuccess('Bot metadata refreshed.');
      mountBotOverview(container, { params });
    },
  });

  container.querySelector('#revalidate').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh')} Checking…`;
    try {
      const result = await api.post(`/bots/${encodeURIComponent(bot.id)}/validate`);
      toastSuccess(`Telegram confirmed @${result.bot.telegram.username || result.bot.displayName}.`);
      mountBotOverview(container, { params });
    } catch (err) {
      toastError(err.message || 'Validation failed.');
      btn.disabled = false;
      btn.innerHTML = `${icon('refresh')} Revalidate token`;
    }
  });
}

function row(label, value, mono = false, capitalize = false) {
  return `<div class="row-between">
    <dt class="muted">${escapeHtml(label)}</dt>
    <dd class="${mono ? 'mono' : ''}" style="margin:0;${capitalize ? 'text-transform:capitalize' : ''}">${escapeHtml(String(value ?? '—'))}</dd>
  </div>`;
}

function yesNo(value) {
  if (value === null || value === undefined) return 'Not reported';
  return value ? 'Yes' : 'No';
}
