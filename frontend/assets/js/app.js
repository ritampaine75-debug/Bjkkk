/**
 * BotForge Studio application bootstrap.
 * Handles theme, authentication gating, shell rendering and route startup.
 */
import { initTheme, getState, setState, subscribe } from './state.js';
import { initAuth } from './auth.js';
import { renderShell } from './components/shell.js';
import { route, setNotFound, handleRoute, currentRoute } from './router.js';
import { renderPageError } from './components/states.js';
import { toastError } from './components/toast.js';
import mountDashboard from './pages/dashboard.js';
import mountBots from './pages/bots.js';
import mountConnectBot from './pages/connect-bot.js';
import mountBotOverview from './pages/bot-overview.js';
import mountBotSettings from './pages/bot-settings.js';
import mountCommands from './pages/commands.js';
import mountWorkflows from './pages/workflows.js';
import mountWorkflowEditor from './pages/workflow-editor.js';
import mountSimulator from './pages/simulator.js';
import mountExecutions from './pages/executions.js';
import mountLiveTest from './pages/live-test.js';
import mountSchedules from './pages/schedules.js';
import mountSettings from './pages/settings.js';
import mountWelcome from './pages/welcome.js';
import mountNotFound from './pages/not-found.js';

const root = document.getElementById('app');
let shell = null;
let booted = false;

function registerRoutes() {
  route('/dashboard', mountDashboard, { requiresAuth: true });
  route('/bots', mountBots, { requiresAuth: true });
  route('/bots/connect', mountConnectBot, { requiresAuth: true });
  route('/bots/:botId', mountBotOverview, { requiresAuth: true });
  route('/bots/:botId/commands', mountCommands, { requiresAuth: true });
  route('/bots/:botId/workflows', mountWorkflows, { requiresAuth: true });
  route('/bots/:botId/workflows/:workflowId', mountWorkflowEditor, { requiresAuth: true });
  route('/bots/:botId/simulator', mountSimulator, { requiresAuth: true });
  route('/bots/:botId/live-test', mountLiveTest, { requiresAuth: true });
  route('/bots/:botId/schedules', mountSchedules, { requiresAuth: true });
  route('/bots/:botId/executions', mountExecutions, { requiresAuth: true });
  route('/bots/:botId/settings', mountBotSettings, { requiresAuth: true });
  route('/settings', mountSettings, { requiresAuth: true });
  route('/login', showWelcome, { requiresAuth: false });
  route('/register', showWelcome, { requiresAuth: false });
  setNotFound(async ({ container }) => {
    await mountNotFound(container || document.getElementById('view'));
  });
}

async function showWelcome() {
  if (getState().user) {
    window.location.hash = '#/dashboard';
    return;
  }
  teardownShell();
  await mountWelcome(root, { container: root });
}

/**
 * Route placeholder for sections delivered in later phases. It is explicit
 * about being unavailable - it never pretends to work.
 */
async function notYet({ container, path }) {
  const view = container || document.getElementById('view');
  view.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="card__body">
          <div class="empty">
            <div class="empty__icon">${iconMarkup('clock')}</div>
            <h3>This section is not available yet</h3>
            <p class="secondary">The route <code>${escapeText(path)}</code> is part of an upcoming implementation phase and has no working behaviour in this build.</p>
            <div class="empty__actions"><a class="btn btn--primary" href="#/dashboard">Back to overview</a></div>
          </div>
        </div>
      </div>
    </div>`;
}

function iconMarkup(name) {
  // Imported lazily to keep the placeholder helper dependency light.
  const paths = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function escapeText(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function ensureShell() {
  if (shell) return shell;
  shell = renderShell(root);
  return shell;
}

function teardownShell() {
  shell = null;
}

async function refresh() {
  const state = getState();
  if (!state.user) {
    await showWelcome();
    return;
  }
  ensureShell();
  const view = document.getElementById('view');
  if (!view) {
    shell = null;
    ensureShell();
  }
  await handleRoute({
    container: document.getElementById('view'),
    onBeforeRender: (path) => {
      const currentShell = shell || renderShell(root);
      shell = currentShell;
      currentShell.setActive(path);
    },
  });
}

async function boot() {
  initTheme();
  registerRoutes();

  try {
    await initAuth();
  } catch (err) {
    root.innerHTML = `<div class="auth-shell"><section class="auth-panel">
      <div class="alert alert--danger"><div class="alert__body">
        <div class="alert__title">Cannot reach the BotForge API</div>
        <div class="alert__text">${escapeText(err.message)}</div>
      </div></div></section></div>`;
    return;
  }

  if (!window.location.hash) window.location.hash = '#/dashboard';
  await refresh();
  booted = true;

  window.addEventListener('hashchange', () => {
    refresh().catch((err) => {
      const view = document.getElementById('view');
      if (view) renderPageError(view, { message: err.message });
    });
  });

  window.addEventListener('botforge:signed-in', () => refresh());
  window.addEventListener('botforge:signout', () => showWelcome());
  window.addEventListener('botforge:unauthorized', () => {
    if (currentRoute() !== '/login') {
      toastError('Your session expired. Please sign in again.');
      window.location.hash = '#/login';
    }
  });

  // Reflect route changes caused elsewhere (e.g. programmatic navigate()).
  subscribe((state) => {
    if (!booted) return;
    if (state.user && !shell) refresh();
  });
}

window.addEventListener('DOMContentLoaded', boot);
