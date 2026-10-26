/** Bot settings: profile, token & security, diagnostics and destructive actions. */
import { escapeHtml, formatDate, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { loadBot } from '../services/bot-context.js';
import { renderBotHeader, bindBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { confirmDialog, promptDialog } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';
import { setState } from '../state.js';

export default async function mountBotSettings(container, { params }) {
  container.innerHTML = skeletonPage();
  let data;
  let diagnostics = null;
  let webhookStatus = null;
  let runtime = null;
  try {
    data = await loadBot(params.botId);
    try {
      const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/diagnostics`);
      diagnostics = res.diagnostics;
    } catch {
      diagnostics = null;
    }
    try {
      const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/webhook`);
      webhookStatus = res.webhook;
    } catch {
      webhookStatus = null;
    }
    try {
      const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/runtime`);
      runtime = res.runtime;
    } catch {
      runtime = null;
    }
  } catch (err) {
    renderPageError(container, { title: 'Could not load bot settings', message: err.message, retry: () => mountBotSettings(container, { params }) });
    return;
  }
  const bot = data.bot;
  const reload = () => mountBotSettings(container, { params });

  container.innerHTML = `
    <div class="page">
      ${renderBotHeader(bot, 'settings')}

      <div class="split-2">
        <div class="stack">
          <section class="card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('settings')} Bot settings</h2>
                <p class="card__subtitle">Internal labels only - Telegram's bot profile is not modified</p>
              </div>
            </div>
            <div class="card__body">
              <form id="settings-form" novalidate>
                <div class="field">
                  <label class="field__label" for="display-name">Internal display name</label>
                  <input class="input" id="display-name" maxlength="80" value="${escapeHtml(bot.displayName)}" required />
                </div>
                <div class="field">
                  <label class="field__label" for="environment">Environment</label>
                  <div class="select-wrap">
                    <select class="select" id="environment">
                      <option value="development" ${bot.environment === 'development' ? 'selected' : ''}>Development</option>
                      <option value="production" ${bot.environment === 'production' ? 'selected' : ''}>Production</option>
                    </select>
                  </div>
                </div>
                <div id="settings-feedback" role="status" aria-live="polite"></div>
                <button class="btn btn--primary" type="submit" id="save-settings">${icon('save')} Save settings</button>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('key')} Token &amp; security</h2>
                <p class="card__subtitle">The stored token is encrypted and never shown again</p>
              </div>
            </div>
            <div class="card__body stack">
              <dl class="stack-sm small" style="margin:0">
                <div class="row-between"><dt class="muted">Stored token</dt><dd class="mono" style="margin:0">${escapeHtml(bot.tokenMask || 'not stored')}</dd></div>
                <div class="row-between"><dt class="muted">Stored since</dt><dd style="margin:0">${escapeHtml(bot.tokenUpdatedAt ? formatDate(bot.tokenUpdatedAt) : '—')}</dd></div>
                <div class="row-between"><dt class="muted">Encryption</dt><dd style="margin:0">AES-256-GCM · key version ${escapeHtml(diagnostics?.token?.keyVersion || 'unknown')}</dd></div>
                <div class="row-between"><dt class="muted">Key rotation needed</dt><dd style="margin:0">${diagnostics?.token?.needsRotation ? 'Yes' : 'No'}</dd></div>
              </dl>

              <form id="token-form" novalidate autocomplete="off">
                <div class="field">
                  <label class="field__label" for="new-token">Replace token <span class="field__optional">optional</span></label>
                  <div class="input-group">
                    <input class="input input--mono" id="new-token" type="password" autocomplete="off" spellcheck="false"
                      placeholder="New token from BotFather" />
                    <button class="btn btn--secondary btn--icon" type="button" id="toggle-new-token" aria-label="Show token">${icon('eye')}</button>
                  </div>
                  <p class="field__hint">Must belong to the same bot. The replacement is validated with Telegram before it is stored.</p>
                </div>
                <label class="checkbox" for="token-ack">
                  <input type="checkbox" id="token-ack" />
                  <span class="checkbox__text">I am authorised to change this bot token.</span>
                </label>
                <div id="token-feedback" role="status" aria-live="polite" style="margin-top:var(--space-3)"></div>
                <button class="btn btn--secondary" type="submit" id="save-token">${icon('key')} Replace token</button>
              </form>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card" id="restrictions-card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('users')} User restrictions</h2>
                <p class="card__subtitle">Decide which Telegram users the live runtime answers</p>
              </div>
              <span class="badge badge--${bot.restrictions?.mode === 'everyone' ? 'neutral' : 'warning'}">${escapeHtml(
                bot.restrictions?.mode || 'everyone',
              )}</span>
            </div>
            <div class="card__body">
              <form id="restrictions-form" class="stack" novalidate>
                <div class="field">
                  <label class="field__label" for="restrictions-mode">Who can use this bot</label>
                  <select class="select" id="restrictions-mode">
                    <option value="everyone"${bot.restrictions?.mode === 'everyone' ? ' selected' : ''}>Everyone (no restriction)</option>
                    <option value="allowlist"${bot.restrictions?.mode === 'allowlist' ? ' selected' : ''}>Only these user IDs</option>
                    <option value="blocklist"${bot.restrictions?.mode === 'blocklist' ? ' selected' : ''}>Everyone except these user IDs</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="restrictions-ids">Telegram user IDs</label>
                  <input class="input input--mono" id="restrictions-ids" placeholder="123456789, 987654321"
                    value="${escapeHtml((bot.restrictions?.userIds || []).join(', '))}" />
                  <p class="field__hint">Comma separated numeric IDs. Restrictions apply to workflows and command replies. Command-level lists take priority.</p>
                </div>
                <div id="restrictions-feedback" role="status" aria-live="polite"></div>
                <button class="btn btn--secondary" type="submit" id="save-restrictions">${icon('save')} Save restrictions</button>
              </form>
            </div>
          </section>

          <section class="card" id="runtime-card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('globe')} Live runtime</h2>
                <p class="card__subtitle">Telegram delivers updates to your bot through this webhook</p>
              </div>
              ${
                webhookStatus
                  ? `<span class="badge badge--${webhookStatus.state === 'active' ? 'success' : webhookStatus.state === 'error' ? 'danger' : 'neutral'}">${escapeHtml(
                      webhookStatus.state.replace(/_/g, ' '),
                    )}</span>`
                  : ''
              }
            </div>
            <div class="card__body stack">
              ${
                webhookStatus?.baseUrlConfigured === false
                  ? `<div class="alert alert--warning small">${icon('alert')}<div class="alert__body"><div class="alert__text">
                      No public base URL is configured. Set <code>TELEGRAM_WEBHOOK_BASE_URL</code> to your HTTPS deployment URL before registering the webhook.
                    </div></div></div>`
                  : ''
              }
              <dl class="stack-sm small" style="margin:0">
                ${diagRow('Webhook URL', webhookStatus?.url || 'not registered')}
                ${diagRow('Registered', webhookStatus?.registeredAt ? relativeTime(webhookStatus.registeredAt) : 'never')}
                ${diagRow('Pending updates', String(webhookStatus?.telegram?.pendingUpdateCount ?? 'unknown'))}
                ${diagRow('Worker', runtime ? `${runtime.worker.state} · ${runtime.queue.active} active / ${runtime.queue.pending} queued` : 'unknown')}
                ${diagRow('Updates processed', runtime ? String(runtime.processedUpdates) : 'unknown')}
                ${diagRow('Last update', runtime?.lastUpdateAt ? relativeTime(runtime.lastUpdateAt) : 'none recorded')}
              </dl>
              ${
                webhookStatus?.lastError
                  ? `<div class="alert alert--danger small">${icon('xCircle')}<div class="alert__body"><div class="alert__text">${escapeHtml(
                      webhookStatus.lastError.message,
                    )}</div></div></div>`
                  : ''
              }
              <div class="row row--wrap">
                <button class="btn btn--primary btn--sm" type="button" id="webhook-register">
                  ${icon('link')} ${webhookStatus?.state === 'active' ? 'Re-register webhook' : 'Register webhook'}
                </button>
                ${
                  webhookStatus?.state === 'active'
                    ? `<button class="btn btn--ghost btn--sm" type="button" id="webhook-remove">${icon('x')} Remove webhook</button>`
                    : ''
                }
                <button class="btn btn--ghost btn--sm" type="button" id="runtime-probe">${icon('zap')} Test routing</button>
                <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/live-test">${icon('send')} Live test</a>
              </div>
              <div id="runtime-feedback" role="status" aria-live="polite"></div>
            </div>
          </section>

          <section class="card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('activity')} Diagnostics</h2>
                <p class="card__subtitle">Reported by BotForge and Telegram</p>
              </div>
            </div>
            <div class="card__body">
              ${
                diagnostics
                  ? `<dl class="stack-sm small" style="margin:0">
                      ${diagRow('Connection', diagnostics.connection.state.replace(/_/g, ' '))}
                      ${diagRow('Last check', diagnostics.connection.lastCheckedAt ? relativeTime(diagnostics.connection.lastCheckedAt) : 'never')}
                      ${diagRow('Webhook (BotForge)', diagnostics.webhook.state.replace(/_/g, ' '))}
                      ${diagRow('Webhook (Telegram)', typeof diagnostics.webhook.telegramReported === 'object' && diagnostics.webhook.telegramReported.error ? 'check failed' : diagnostics.webhook.telegramReported?.url ? 'registered' : 'not set')}
                      ${diagRow('Pending updates', String(diagnostics.webhook.telegramReported?.pendingUpdateCount ?? 'unknown'))}
                      ${diagRow('Worker', diagnostics.worker.state)}
                      ${diagRow('Last update', diagnostics.updates.lastUpdateAt ? relativeTime(diagnostics.updates.lastUpdateAt) : 'none recorded')}
                      ${diagRow('Last execution', diagnostics.executions.last ? `${diagnostics.executions.last.status} · ${relativeTime(diagnostics.executions.last.startedAt)}` : 'none')}
                    </dl>
                    <p class="field__hint" style="margin-top:var(--space-3)">
                      "Unknown" means the value cannot be determined reliably, for example because live runtime features are not active.
                    </p>`
                  : `<div class="alert alert--warning small">${icon('alert')}
                      <div class="alert__body"><div class="alert__text">Diagnostics could not be loaded.</div></div></div>`
              }
              <button class="btn btn--secondary btn--sm" type="button" id="refresh-diagnostics" style="margin-top:var(--space-3)">
                ${icon('refresh')} Re-run diagnostics
              </button>
            </div>
          </section>

          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('shield')} Danger zone</h2></div>
            <div class="card__body stack-sm">
              <p class="small secondary" style="margin:0">
                Revoking deletes the encrypted token and removes the webhook. Deleting removes the whole workspace,
                including workflows, commands and execution history.
              </p>
              <button class="btn btn--danger-ghost btn--block" type="button" id="revoke">${icon('lock')} Revoke connection</button>
              <button class="btn btn--danger btn--block" type="button" id="delete">${icon('trash')} Delete bot workspace</button>
            </div>
          </section>
        </div>
      </div>
    </div>`;

  bindBotHeader(container, {
    bot,
    onRefresh: async () => {
      try {
        await api.post(`/bots/${encodeURIComponent(bot.id)}/validate`);
        toastSuccess('Connection revalidated.');
      } catch (err) {
        toastError(err.message);
      }
      reload();
    },
  });

  container.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = container.querySelector('#display-name').value.trim();
    const environment = container.querySelector('#environment').value;
    const feedback = container.querySelector('#settings-feedback');
    feedback.innerHTML = '';
    if (!name) {
      feedback.innerHTML = feedbackHtml('danger', 'A display name is required.');
      return;
    }
    try {
      await api.patch(`/bots/${encodeURIComponent(bot.id)}`, { displayName: name, environment });
      toastSuccess('Bot settings saved.');
      reload();
    } catch (err) {
      feedback.innerHTML = feedbackHtml('danger', err.message);
    }
  });

  const newToken = container.querySelector('#new-token');
  container.querySelector('#toggle-new-token').addEventListener('click', (event) => {
    const show = newToken.type === 'password';
    newToken.type = show ? 'text' : 'password';
    event.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye');
    event.currentTarget.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  });

  container.querySelector('#token-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = container.querySelector('#token-feedback');
    feedback.innerHTML = '';
    const value = newToken.value.trim();
    if (!value) {
      feedback.innerHTML = feedbackHtml('danger', 'Enter the new token first.');
      return;
    }
    if (!container.querySelector('#token-ack').checked) {
      feedback.innerHTML = feedbackHtml('danger', 'Confirm you are authorised to change this token.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Replace the stored token?',
      message: 'The current token will be overwritten after Telegram confirms the new one. Workflows keep running with the new token.',
      confirmLabel: 'Replace token',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      await api.post(`/bots/${encodeURIComponent(bot.id)}/token`, { token: value, acknowledgeOwnership: true });
      newToken.value = '';
      container.querySelector('#token-ack').checked = false;
      toastSuccess('Token replaced and re-validated with Telegram.');
      reload();
    } catch (err) {
      feedback.innerHTML = feedbackHtml('danger', err.message);
    }
  });

  container.querySelector('#refresh-diagnostics').addEventListener('click', reload);

  container.querySelector('#restrictions-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = container.querySelector('#restrictions-feedback');
    feedback.innerHTML = '';
    const mode = container.querySelector('#restrictions-mode').value;
    const ids = container
      .querySelector('#restrictions-ids')
      .value.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      await api.patch(`/bots/${encodeURIComponent(bot.id)}/restrictions`, { mode, userIds: ids });
      toastSuccess('User restrictions saved.');
      reload();
    } catch (err) {
      feedback.innerHTML = feedbackHtml('danger', err.message);
    }
  });

  const runtimeFeedback = container.querySelector('#runtime-feedback');

  container.querySelector('#webhook-register').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    runtimeFeedback.innerHTML = '';
    try {
      const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/webhook`, {});
      toastSuccess('Webhook registered with Telegram.');
      runtimeFeedback.innerHTML = feedbackHtml('info', `Telegram will now deliver updates to ${res.webhook.url}.`);
      reload();
    } catch (err) {
      runtimeFeedback.innerHTML = feedbackHtml('danger', err.message);
    } finally {
      button.disabled = false;
    }
  });

  const removeWebhook = container.querySelector('#webhook-remove');
  if (removeWebhook) {
    removeWebhook.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Remove the webhook?',
        message: 'Telegram stops delivering updates to BotForge and your workflows stop running until you register it again.',
        confirmLabel: 'Remove webhook',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await api.delete(`/bots/${encodeURIComponent(bot.id)}/webhook`);
        toastSuccess('Webhook removed.');
        reload();
      } catch (err) {
        toastError(err.message);
      }
    });
  }

  container.querySelector('#runtime-probe').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    runtimeFeedback.innerHTML = '';
    try {
      const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/runtime/simulate-update`, {
        text: '/start',
        dryRun: true,
      });
      runtimeFeedback.innerHTML = feedbackHtml(
        res.matched > 0 ? 'info' : 'warning',
        res.matched > 0
          ? `Routing works: ${res.matched} workflow(s) matched. ${res.executions.map((e) => `${e.workflowName || 'command reply'}: ${e.status}`).join(', ')}`
          : 'No published workflow matched /start. Publish a workflow with a /start trigger first.',
      );
    } catch (err) {
      runtimeFeedback.innerHTML = feedbackHtml('danger', err.message);
    } finally {
      button.disabled = false;
    }
  });

  container.querySelector('#revoke').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Revoke this bot connection?',
      message: 'The encrypted token will be deleted and the Telegram webhook removed. Workflows stop receiving updates until you reconnect.',
      confirmLabel: 'Revoke connection',
      tone: 'danger',
      requireText: bot.displayName,
    });
    if (!confirmed) return;
    try {
      await api.post(`/bots/${encodeURIComponent(bot.id)}/revoke`, { confirm: true });
      toastSuccess('Connection revoked.');
      reload();
    } catch (err) {
      toastError(err.message);
    }
  });

  container.querySelector('#delete').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Delete this bot workspace?',
      message: 'This permanently deletes the bot, its workflows, commands and execution history. This cannot be undone.',
      confirmLabel: 'Delete workspace',
      tone: 'danger',
      requireText: bot.displayName,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/bots/${encodeURIComponent(bot.id)}`, { body: { confirm: true } });
      setState({ activeBotId: null });
      toastSuccess('Bot workspace deleted.');
      window.location.hash = '#/bots';
    } catch (err) {
      toastError(err.message);
    }
  });
}

function feedbackHtml(tone, message) {
  return `<div class="alert alert--${tone} small" style="margin-bottom:var(--space-3)">
    ${icon(tone === 'danger' ? 'alert' : 'info')}
    <div class="alert__body"><div class="alert__text">${escapeHtml(message)}</div></div>
  </div>`;
}

function diagRow(label, value) {
  return `<div class="row-between"><dt class="muted">${escapeHtml(label)}</dt><dd style="margin:0;text-transform:capitalize">${escapeHtml(String(value))}</dd></div>`;
}
