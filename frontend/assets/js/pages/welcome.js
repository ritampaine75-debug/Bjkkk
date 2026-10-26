/**
 * Welcome / authentication screen. Shown when no session exists.
 * Handles both local and Firebase authentication modes with the same UI.
 */
import { html, raw, escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { initAuth, signIn, signUp } from '../auth.js';
import { getState, setState } from '../state.js';
import { toastSuccess } from '../components/toast.js';

let mode = 'signin'; // 'signin' | 'signup'

export default async function mountWelcome(root, { container } = {}) {
  const authConfig = await initAuth();
  if (getState().user) {
    window.location.hash = '#/dashboard';
    return;
  }
  setState({ authReady: true });
  const target = container || root;

  const render = () => {
    const isSignup = mode === 'signup';
    target.innerHTML = `
      <div class="auth-shell">
        <section class="auth-hero" aria-label="About BotForge Studio">
          <div class="auth-hero__content">
            <div class="row" style="gap:10px;margin-bottom:var(--space-8)">
              <span style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.12)">
                ${icon('zap', { size: 18 })}
              </span>
              <strong style="color:#fff;letter-spacing:-.02em">BotForge Studio</strong>
            </div>
            <h1>Manage your Telegram bots without writing code.</h1>
            <p>Connect a BotFather token, build commands and automations in a form or on a visual canvas,
            test every conversation in a simulator, then publish to a live webhook runtime.</p>
            <ul style="list-style:none;padding:0;margin:var(--space-8) 0 0;display:grid;gap:var(--space-3)">
              ${[
                ['shield', 'Bot tokens encrypted with AES-256-GCM and never returned to the browser'],
                ['workflow', 'One workflow schema, two editors: beginner forms and advanced nodes'],
                ['flask', 'Simulator runs your real workflow logic against a mocked Telegram API'],
                ['logs', 'Execution history with per-step status and safe error summaries'],
              ]
                .map(
                  ([ic, text]) => `<li class="row" style="gap:10px;align-items:flex-start;color:rgba(255,255,255,.82);font-size:var(--fs-base)">
                    <span style="color:#a8c3ff;flex:none;margin-top:1px">${icon(ic, { size: 18 })}</span>
                    <span>${escapeHtml(text)}</span>
                  </li>`,
                )
                .join('')}
            </ul>
          </div>
        </section>

        <section class="auth-panel">
          <div class="stack" style="width:100%">
            <div>
              <div class="row" style="margin-bottom:var(--space-6)">
                <span class="topbar__brand-mark" style="width:32px;height:32px">${icon('zap', { size: 18 })}</span>
                <strong style="font-size:var(--fs-md);letter-spacing:-.02em">BotForge Studio</strong>
              </div>
              <h1 style="font-size:var(--fs-2xl)">${isSignup ? 'Create your account' : 'Sign in'}</h1>
              <p class="secondary" style="margin-top:var(--space-2)">
                ${
                  isSignup
                    ? 'Your bots, workflows and logs stay private to your account.'
                    : 'Continue to your bot workspaces and automations.'
                }
              </p>
            </div>

            <div class="segmented" role="group" aria-label="Authentication mode" style="width:100%">
              <button type="button" data-mode="signin" aria-pressed="${!isSignup}" style="flex:1">Sign in</button>
              <button type="button" data-mode="signup" aria-pressed="${isSignup}" style="flex:1"
                ${authConfig.config?.allowSignup === false ? 'disabled title="Sign-up is managed in Firebase"' : ''}>Create account</button>
            </div>

            <form id="auth-form" novalidate>
              ${
                isSignup
                  ? `<div class="field">
                      <label class="field__label" for="displayName">Name <span class="field__optional">optional</span></label>
                      <input class="input" id="displayName" name="displayName" autocomplete="name" maxlength="80" placeholder="Alex Doe" />
                    </div>`
                  : ''
              }
              <div class="field">
                <label class="field__label" for="email">Email</label>
                <input class="input" id="email" name="email" type="email" autocomplete="email" required
                  inputmode="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" />
              </div>
              <div class="field" style="margin-bottom:var(--space-3)">
                <label class="field__label" for="password">Password</label>
                <div class="input-group">
                  <input class="input" id="password" name="password" type="password" required
                    autocomplete="${isSignup ? 'new-password' : 'current-password'}" minlength="8" />
                  <button class="btn btn--secondary btn--icon" type="button" id="toggle-password" aria-label="Show password">
                    ${icon('eye')}
                  </button>
                </div>
                <p class="field__hint">${isSignup ? 'At least 8 characters.' : ''}</p>
              </div>

              <div id="auth-error" role="alert" aria-live="assertive"></div>

              <button class="btn btn--primary btn--lg btn--block" type="submit" id="auth-submit">
                ${isSignup ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <div class="alert alert--info small">
              ${icon('shield')}
              <div class="alert__body">
                <div class="alert__text">BotForge never asks for your Telegram password, login code or two-factor code.
                Connecting a bot requires only the token issued by BotFather.</div>
              </div>
            </div>

            <p class="tiny muted" style="text-align:center">
              Authentication mode: <code>${escapeHtml(authConfig.mode)}</code>
              ${authConfig.mode === 'local' ? ' · development sign-in (not for production)' : ''}
            </p>
          </div>
        </section>
      </div>`;

    target.querySelectorAll('[data-mode]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        mode = btn.dataset.mode;
        render();
      }),
    );

    const passwordInput = target.querySelector('#password');
    target.querySelector('#toggle-password')?.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      const btn = target.querySelector('#toggle-password');
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      btn.innerHTML = icon(isPassword ? 'eyeOff' : 'eye');
    });

    target.querySelector('#auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitBtn = target.querySelector('#auth-submit');
      const errorBox = target.querySelector('#auth-error');
      errorBox.innerHTML = '';
      const email = target.querySelector('#email').value.trim();
      const password = target.querySelector('#password').value;
      const displayName = target.querySelector('#displayName')?.value.trim();

      if (!email || !password) {
        errorBox.innerHTML = alertHtml('Enter your email and password.');
        return;
      }
      if (mode === 'signup' && password.length < 8) {
        errorBox.innerHTML = alertHtml('Password must be at least 8 characters.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
      try {
        const user = mode === 'signup' ? await signUp({ email, password, displayName }) : await signIn({ email, password });
        toastSuccess(mode === 'signup' ? 'Account created. Welcome to BotForge Studio.' : `Signed in as ${user.email}`);
        setState({ user });
        window.location.hash = '#/dashboard';
      } catch (err) {
        errorBox.innerHTML = alertHtml(err.message || 'Sign-in failed.');
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
      }
    });
  };

  render();
  return html`${raw('')}`;
}

function alertHtml(message) {
  return `<div class="alert alert--danger" style="margin-bottom:var(--space-3)">
    ${icon('alert')}
    <div class="alert__body"><div class="alert__text">${escapeHtml(message)}</div></div>
  </div>`;
}
