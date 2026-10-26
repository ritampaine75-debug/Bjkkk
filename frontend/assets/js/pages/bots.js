/** My Bots: list of connected bots with environment and connection state. */
import { escapeHtml, relativeTime, initials } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { listBots } from '../services/bot-context.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { stateBadge } from '../components/bot-header.js';

export default async function mountBots(container) {
  container.innerHTML = skeletonPage();
  let bots;
  try {
    bots = await listBots();
  } catch (err) {
    renderPageError(container, { title: 'Could not load your bots', message: err.message, retry: () => mountBots(container) });
    return;
  }

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">My Bots</h1>
          <p class="page-header__subtitle">Every bot you connect gets its own workspace for commands, automations and logs.</p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--primary" href="#/bots/connect">${icon('plus')} Connect bot</a>
        </div>
      </header>

      ${
        bots.length === 0
          ? `<section class="card">
              <div class="card__body">
                <div class="empty">
                  <div class="empty__icon">${icon('bot')}</div>
                  <h3>No bots connected</h3>
                  <p class="secondary">Create a bot with <strong>@BotFather</strong> on Telegram, copy its token, then connect it here.
                  BotForge never asks for your Telegram account credentials.</p>
                  <div class="empty__actions">
                    <a class="btn btn--primary" href="#/bots/connect">${icon('plus')} Connect your first bot</a>
                    <a class="btn btn--secondary" href="#/dashboard">Back to overview</a>
                  </div>
                </div>
              </div>
            </section>`
          : `<div class="grid cols-2">
              ${bots.map(botCard).join('')}
            </div>
            <div class="alert alert--info small">
              ${icon('info')}
              <div class="alert__body"><div class="alert__text">
                Telegram exposes limited profile data through the Bot API. Fields such as bot description, about text and
                BotFather-only settings are shown as unavailable unless managed by BotForge or confirmed by Telegram.
              </div></div>
            </div>`
      }
    </div>`;
}

function botCard(bot) {
  return `<article class="card card--interactive">
    <div class="card__body">
      <div class="row-between" style="align-items:flex-start">
        <div class="row" style="gap:var(--space-3);align-items:flex-start;min-width:0">
          <span class="avatar" style="width:38px;height:38px;border-radius:11px" aria-hidden="true">
            ${escapeHtml(initials(bot.displayName || bot.telegram?.username || 'B'))}
          </span>
          <div style="min-width:0">
            <h2 class="card__title truncate">${escapeHtml(bot.displayName)}</h2>
            <div class="small muted truncate">
              ${bot.telegram?.username ? `@${escapeHtml(bot.telegram.username)}` : 'Username unavailable'}
            </div>
          </div>
        </div>
        ${stateBadge(bot.connection.state)}
      </div>

      <dl class="stack-sm small" style="margin:var(--space-4) 0 0">
        <div class="row-between"><dt class="muted">Environment</dt><dd style="margin:0;text-transform:capitalize">${escapeHtml(bot.environment)}</dd></div>
        <div class="row-between"><dt class="muted">Telegram bot ID</dt><dd class="mono" style="margin:0">${escapeHtml(bot.telegram?.id || '—')}</dd></div>
        <div class="row-between"><dt class="muted">Token</dt><dd class="mono" style="margin:0">${escapeHtml(bot.tokenMask || 'not stored')}</dd></div>
        <div class="row-between"><dt class="muted">Last checked</dt><dd style="margin:0">${escapeHtml(bot.connection.lastCheckedAt ? relativeTime(bot.connection.lastCheckedAt) : 'never')}</dd></div>
      </dl>
    </div>
    <div class="card__footer">
      <a class="btn btn--secondary btn--sm" href="#/bots/${encodeURIComponent(bot.id)}">Open workspace</a>
      <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(bot.id)}/settings">${icon('settings')} Settings</a>
    </div>
  </article>`;
}
