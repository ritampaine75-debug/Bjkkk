/** Account settings: profile, appearance, session and security notes. */
import { escapeHtml, formatDate } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { authApi } from '../api-client.js';
import { getState, setThemePreference } from '../state.js';
import { signOut } from '../auth.js';
import { confirmDialog } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';

const THEME_OPTIONS = [
  { id: 'system', label: 'System', description: 'Follow your device setting' },
  { id: 'light', label: 'Light', description: 'Bright interface' },
  { id: 'dark', label: 'Dark', description: 'Low-light interface' },
];

export default async function mountSettings(container) {
  const state = getState();
  const user = state.user || {};

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">Account settings</h1>
          <p class="page-header__subtitle">Profile, appearance and session for your BotForge account.</p>
        </div>
      </header>

      <div class="split-2">
        <div class="stack">
          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('user')} Profile</h2></div>
            <div class="card__body">
              <div class="row" style="gap:var(--space-3);margin-bottom:var(--space-4)">
                <span class="avatar" style="width:44px;height:44px;font-size:var(--fs-md)" aria-hidden="true">
                  ${escapeHtml((user.displayName || user.email || '?').slice(0, 1).toUpperCase())}
                </span>
                <div>
                  <div style="font-weight:650">${escapeHtml(user.displayName || 'Unnamed account')}</div>
                  <div class="small muted">${escapeHtml(user.email || '')}</div>
                </div>
              </div>
              <dl class="stack-sm small" style="margin:0">
                <div class="row-between"><dt class="muted">User ID</dt><dd class="mono" style="margin:0">${escapeHtml(user.uid || '—')}</dd></div>
                <div class="row-between"><dt class="muted">Sign-in method</dt><dd style="margin:0">${escapeHtml(user.authProvider || state.authMode)}</dd></div>
                <div class="row-between"><dt class="muted">Account created</dt><dd style="margin:0">${escapeHtml(formatDate(user.createdAt, { withTime: false }))}</dd></div>
              </dl>
              <p class="field__hint" style="margin-top:var(--space-3)">
                ${state.authMode === 'firebase'
                  ? 'Profile details come from Firebase Authentication. Update your name or password there.'
                  : 'Development sign-in stores a scrypt password hash on the server. Configure Firebase Authentication before production use.'}
              </p>
            </div>
          </section>

          <section class="card">
            <div class="card__header">
              <div>
                <h2 class="card__title">${icon('eye')} Appearance</h2>
                <p class="card__subtitle">Applies to this browser only</p>
              </div>
            </div>
            <div class="card__body">
              <div class="segmented" role="group" aria-label="Theme preference" id="theme-group">
                ${THEME_OPTIONS.map(
                  (option) =>
                    `<button type="button" data-theme-option="${option.id}" aria-pressed="${state.theme === option.id}"
                      title="${escapeHtml(option.description)}">${escapeHtml(option.label)}</button>`,
                ).join('')}
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('shield')} Security</h2></div>
            <div class="card__body stack-sm">
              <div class="alert alert--info small">
                ${icon('lock')}
                <div class="alert__body">
                  <div class="alert__text">Bot tokens are encrypted server-side with AES-256-GCM and are never returned to this browser after saving.</div>
                </div>
              </div>
              <ul class="small secondary stack-sm" style="padding-left:1.1rem;margin:0">
                <li>Your bots and workflows are scoped to your account on every request.</li>
                <li>Simulated conversations never reach Telegram.</li>
                <li>Execution logs keep redacted input summaries only.</li>
              </ul>
            </div>
          </section>

          <section class="card">
            <div class="card__header"><h2 class="card__title">${icon('logout')} Session</h2></div>
            <div class="card__body stack-sm">
              <p class="small secondary" style="margin:0">Signing out removes the session token from this browser.</p>
              <button class="btn btn--secondary btn--block" type="button" id="signout">${icon('logout')} Sign out</button>
            </div>
          </section>
        </div>
      </div>
    </div>`;

  container.querySelectorAll('[data-theme-option]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const preference = btn.dataset.themeOption;
      setThemePreference(preference);
      container.querySelectorAll('[data-theme-option]').forEach((other) => {
        other.setAttribute('aria-pressed', String(other.dataset.themeOption === preference));
      });
      try {
        await authApi.updatePreferences({ theme: preference });
      } catch {
        /* local preference still applies even if the server copy fails */
      }
    }),
  );

  container.querySelector('#signout').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Sign out?',
      message: 'You will need to sign in again to access your bots and automations.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await signOut();
      toastSuccess('Signed out.');
      window.location.hash = '#/login';
    } catch (err) {
      toastError(err.message || 'Could not sign out.');
    }
  });
}
