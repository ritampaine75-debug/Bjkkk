/**
 * Connect Bot page.
 *
 * The token is typed into a password field, sent once to the API, and cleared
 * on success. It is never written to storage, URLs, analytics or logs.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { toastSuccess } from '../components/toast.js';

export default async function mountConnectBot(container) {
  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">Connect a Telegram bot</h1>
          <p class="page-header__subtitle">Paste the token BotFather gave you. It is validated with Telegram and encrypted before storage.</p>
        </div>
        <div class="page-header__actions">
          <a class="btn btn--secondary" href="#/bots">${icon('arrowLeft')} Back to bots</a>
        </div>
      </header>

      <div class="split-2">
        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">${icon('key')} Bot credentials</h2>
              <p class="card__subtitle">Nothing is saved until Telegram confirms the token.</p>
            </div>
          </div>
          <div class="card__body">
            <form id="connect-form" novalidate autocomplete="off">
              <div class="field">
                <label class="field__label" for="token">Bot token</label>
                <div class="input-group">
                  <input class="input input--mono" id="token" name="token" type="password" required
                    autocomplete="off" spellcheck="false" autocapitalize="off"
                    placeholder="123456789:AAH..." aria-describedby="token-hint" />
                  <button class="btn btn--secondary btn--icon" type="button" id="toggle-token" aria-label="Show token">
                    ${icon('eye')}
                  </button>
                </div>
                <p class="field__hint" id="token-hint">
                  In Telegram, open <strong>@BotFather</strong> → <code>/mybots</code> → your bot → <em>API Token</em>.
                  The token is sent over HTTPS to this server only.
                </p>
              </div>

              <div class="field">
                <label class="field__label" for="displayName">Internal display name <span class="field__optional">optional</span></label>
                <input class="input" id="displayName" name="displayName" maxlength="80"
                  placeholder="Support bot (production)" aria-describedby="display-hint" />
                <p class="field__hint" id="display-hint">Only visible inside BotForge. Telegram's bot name is not changed.</p>
              </div>

              <div class="field">
                <label class="field__label" for="environment">Environment</label>
                <div class="select-wrap">
                  <select class="select" id="environment" name="environment">
                    <option value="development">Development</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <p class="field__hint">Used for labelling. Publishing a workflow to production asks for extra confirmation.</p>
              </div>

              <label class="checkbox" for="acknowledge">
                <input type="checkbox" id="acknowledge" name="acknowledge" />
                <span class="checkbox__text">
                  <strong>I own this bot or am authorised to administer it.</strong>
                  Only connect bots you control. BotForge never asks for your Telegram login, SMS code or two-factor password.
                </span>
              </label>

              <div id="connect-error" role="alert" aria-live="assertive" style="margin-top:var(--space-3)"></div>

              <div class="row" style="margin-top:var(--space-4)">
                <button class="btn btn--primary" type="submit" id="connect-submit">${icon('link')} Connect bot</button>
                <a class="btn btn--ghost" href="#/bots">Cancel</a>
              </div>
            </form>
          </div>
        </section>

        <aside class="stack">
          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('shield')} How the token is handled</h2></div>
            <div class="card__body stack-sm small secondary">
              <p style="margin:0">Validated server-side against Telegram's <code>getMe</code> before anything is stored.</p>
              <p style="margin:0">Encrypted at rest with AES-256-GCM using a key that never leaves the server.</p>
              <p style="margin:0">Never returned to the browser again - this page only shows a masked form afterwards.</p>
              <p style="margin:0">Never written to browser storage, URLs, analytics or application logs.</p>
            </div>
          </section>
          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('info')} What Telegram can report</h2></div>
            <div class="card__body small secondary">
              <p style="margin:0 0 var(--space-2)"><strong>Available:</strong> bot ID, username, first name, group and inline capabilities.</p>
              <p style="margin:0"><strong>Not available:</strong> whether the bot is "online", its full BotFather settings, or historical conversations.
              Those are managed in Telegram and shown as unavailable rather than guessed.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>`;

  const form = container.querySelector('#connect-form');
  const tokenInput = container.querySelector('#token');
  const errorBox = container.querySelector('#connect-error');
  const submit = container.querySelector('#connect-submit');

  container.querySelector('#toggle-token').addEventListener('click', (event) => {
    const show = tokenInput.type === 'password';
    tokenInput.type = show ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
    event.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.innerHTML = '';
    const token = tokenInput.value.trim();
    const displayName = container.querySelector('#displayName').value.trim();
    const environment = container.querySelector('#environment').value;
    const acknowledgeOwnership = container.querySelector('#acknowledge').checked;

    if (!token) {
      errorBox.innerHTML = errorHtml('Enter the bot token from BotFather.');
      tokenInput.focus();
      return;
    }
    if (!acknowledgeOwnership) {
      errorBox.innerHTML = errorHtml('Confirm that you are authorised to administer this bot.');
      return;
    }

    submit.disabled = true;
    submit.innerHTML = `${icon('refresh')} Validating with Telegram…`;
    try {
      const { bot } = await api.post('/bots/connect', {
        token,
        displayName: displayName || undefined,
        environment,
        acknowledgeOwnership,
      });
      // Clear the secret from the DOM as soon as it is no longer needed.
      tokenInput.value = '';
      errorBox.innerHTML = '';
      toastSuccess(`Connected @${bot.telegram.username || bot.displayName}.`);
      window.location.hash = `#/bots/${encodeURIComponent(bot.id)}`;
    } catch (err) {
      if (err.code === 'conflict' && err.details?.existingBotId) {
        errorBox.innerHTML = `<div class="alert alert--warning">
          ${icon('alert')}
          <div class="alert__body">
            <div class="alert__title">This bot is already connected</div>
            <div class="alert__text">${escapeHtml(err.message)}</div>
            <a class="btn btn--secondary btn--sm" style="margin-top:8px"
              href="#/bots/${encodeURIComponent(err.details.existingBotId)}">Open existing bot</a>
          </div>
        </div>`;
      } else {
        errorBox.innerHTML = errorHtml(err.message || 'The bot could not be connected.');
      }
      submit.disabled = false;
      submit.innerHTML = `${icon('link')} Connect bot`;
    }
  });
}

function errorHtml(message) {
  return `<div class="alert alert--danger">
    ${icon('alert')}
    <div class="alert__body"><div class="alert__text">${escapeHtml(message)}</div></div>
  </div>`;
}
