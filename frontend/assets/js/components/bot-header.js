import { escapeHtml, initials } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

export const BOT_TABS = [
  { id: 'overview', label: 'Overview', href: '#/bots/:botId', exact: true },
  { id: 'commands', label: 'Commands', href: '#/bots/:botId/commands' },
  { id: 'workflows', label: 'Automations', href: '#/bots/:botId/workflows' },
  { id: 'builder', label: 'Visual Builder', href: '#/bots/:botId/builder' },
  { id: 'simulator', label: 'Simulator', href: '#/bots/:botId/simulator' },
  { id: 'live-test', label: 'Live Test', href: '#/bots/:botId/live-test' },
  { id: 'executions', label: 'Executions', href: '#/bots/:botId/executions' },
  { id: 'settings', label: 'Settings', href: '#/bots/:botId/settings' },
];

const STATE_TONE = {
  connected: 'success',
  invalid_token: 'danger',
  revoked: 'neutral',
  error: 'danger',
  unknown: 'warning',
};

export function stateBadge(state) {
  const tone = STATE_TONE[state] || 'warning';
  return `<span class="badge badge--${tone} badge--dot">${escapeHtml(String(state || 'unknown').replace(/_/g, ' '))}</span>`;
}

/** Renders the bot identity header plus workspace tabs. */
export function renderBotHeader(bot, activeTab = 'overview') {
  const tabs = BOT_TABS.map((tab) => {
    const href = tab.href.replace(':botId', encodeURIComponent(bot.id));
    return `<a class="tabs__tab" href="${href}" role="tab" aria-selected="${tab.id === activeTab}">${escapeHtml(tab.label)}</a>`;
  }).join('');

  return `
    <div class="stack">
      <div class="row-between" style="align-items:flex-start">
        <div class="row" style="gap:var(--space-3);align-items:flex-start">
          <span class="avatar" style="width:42px;height:42px;border-radius:12px;font-size:var(--fs-md)" aria-hidden="true">
            ${escapeHtml(initials(bot.displayName || bot.telegram?.username || 'B'))}
          </span>
          <div>
            <h1 style="font-size:var(--fs-xl)">${escapeHtml(bot.displayName || 'Bot')}</h1>
            <div class="row small muted" style="gap:var(--space-2);margin-top:2px">
              ${bot.telegram?.username ? `<span>@${escapeHtml(bot.telegram.username)}</span>` : '<span>Username unavailable</span>'}
              <span>·</span>
              ${stateBadge(bot.connection.state)}
              <span class="badge badge--neutral">${escapeHtml(bot.environment)}</span>
            </div>
          </div>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--secondary btn--sm" href="#/bots">${icon('arrowLeft')} All bots</a>
          <button class="btn btn--secondary btn--sm" type="button" data-refresh-bot>${icon('refresh')} Refresh</button>
        </div>
      </div>
      <div class="tabs" role="tablist" aria-label="Bot workspace sections">${tabs}</div>
    </div>`;
}

/** Wire shared bot header interactions. */
export function bindBotHeader(root, { bot, onRefresh }) {
  root.querySelector('[data-refresh-bot]')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      await onRefresh?.();
    } finally {
      btn.disabled = false;
    }
  });
  return bot;
}
