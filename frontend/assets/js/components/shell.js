import { icon } from '../utils/icons.js';
import { escapeHtml, initials } from '../utils/dom.js';
import { primaryNav, secondaryNav, mobileNav, resolveNav } from '../nav.js';
import { getState, setThemePreference } from '../state.js';

const THEME_LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };

export function renderShell(root) {
  const state = getState();
  const navItems = resolveNav(primaryNav, state.activeBotId);
  const secondary = resolveNav(secondaryNav, state.activeBotId);
  const mobile = resolveNav(mobileNav, state.activeBotId);

  root.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="app-shell">
      <header class="topbar">
        <a class="topbar__brand" href="#/dashboard">
          <span class="topbar__brand-mark">${icon('zap', { size: 16 })}</span>
          <span>BotForge</span>
        </a>
        <span class="topbar__spacer"></span>
        <div class="topbar__actions">
          <button class="icon-btn" type="button" data-theme-toggle aria-label="${THEME_LABELS[state.theme]}">
            ${icon('eye', { size: 17 })}
          </button>
          <button class="icon-btn" type="button" data-menu-toggle aria-label="Account menu" aria-expanded="false">
            ${icon('user', { size: 17 })}
          </button>
        </div>
      </header>

      <aside class="sidebar" aria-label="Primary">
        <a class="topbar__brand" href="#/dashboard" style="padding: var(--space-2) var(--space-3)">
          <span class="topbar__brand-mark">${icon('zap', { size: 16 })}</span>
          <span>BotForge Studio</span>
        </a>
        <nav class="sidenav" aria-label="Workspace">
          ${navItems.map(navLink).join('')}
        </nav>
        <div class="spacer"></div>
        <hr class="divider" />
        <nav class="sidenav" aria-label="Account">
          ${secondary.map(navLink).join('')}
        </nav>
        <div class="user-chip">
          <span class="avatar" aria-hidden="true">${escapeHtml(initials(state.user?.displayName || state.user?.email))}</span>
          <span class="user-chip__text">
            <span class="user-chip__name">${escapeHtml(state.user?.displayName || 'Signed in')}</span>
            <span class="user-chip__email">${escapeHtml(state.user?.email || '')}</span>
          </span>
        </div>
      </aside>

      <main class="main" id="main-content" tabindex="-1">
        <div id="view" class="view-root"></div>
      </main>

      <nav class="mobilenav" aria-label="Primary mobile">
        ${mobile
          .map(
            (item) => `
          <a href="${item.disabled ? '#/bots' : item.href}" data-nav-id="${item.id}"
             ${item.disabled ? 'aria-disabled="true" title="Select a bot first"' : ''}>
            ${icon(item.icon, { size: 20 })}
            <span>${escapeHtml(item.label)}</span>
          </a>`,
          )
          .join('')}
      </nav>
    </div>
    <div id="account-drawer"></div>
  `;

  root.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const next = THEME_CYCLE[getState().theme] || 'system';
    setThemePreference(next);
    const btn = root.querySelector('[data-theme-toggle]');
    btn.setAttribute('aria-label', THEME_LABELS[next]);
  });

  root.querySelector('[data-menu-toggle]')?.addEventListener('click', openAccountMenu);
  return { setActive: setActiveNav };
}

export function setActiveNav(path) {
  const clean = path.replace(/^#/, '').split('?')[0];
  document.querySelectorAll('.sidenav__link, .mobilenav a').forEach((link) => {
    const href = (link.getAttribute('href') || '').replace(/^#/, '');
    const isActive =
      href === clean ||
      (href !== '/' &&
        clean.startsWith(href) &&
        (clean.length === href.length || clean[href.length] === '/'));
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function navLink(item) {
  if (item.disabled) {
    return `<a class="sidenav__link" href="#/bots" aria-disabled="true" title="Connect a bot to unlock this section"
      style="opacity:.55">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`;
  }
  return `<a class="sidenav__link" href="${item.href}" data-nav-id="${item.id}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`;
}

function openAccountMenu() {
  const state = getState();
  const drawer = document.getElementById('account-drawer');
  if (!drawer) return;
  drawer.innerHTML = `
    <dialog class="modal" id="account-dialog">
      <div class="modal__header">
        <div class="row">
          <span class="avatar" aria-hidden="true">${escapeHtml(initials(state.user?.displayName || state.user?.email))}</span>
          <div>
            <div class="card__title">${escapeHtml(state.user?.displayName || 'Account')}</div>
            <div class="small muted">${escapeHtml(state.user?.email || '')}</div>
          </div>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal__body stack-sm">
        <a class="btn btn--secondary btn--block" href="#/settings">${icon('settings')} Account settings</a>
        <button class="btn btn--ghost btn--block" type="button" id="sign-out-btn">${icon('logout')} Sign out</button>
      </div>
    </dialog>`;
  const dialog = drawer.querySelector('dialog');
  dialog.querySelector('[data-close]').addEventListener('click', () => {
    dialog.close();
  });
  dialog.querySelector('#sign-out-btn').addEventListener('click', async () => {
    const { signOut } = await import('../auth.js');
    dialog.close();
    await signOut();
    window.location.hash = '#/login';
    window.dispatchEvent(new CustomEvent('botforge:signout'));
  });
  dialog.showModal();
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
