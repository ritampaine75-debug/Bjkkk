/**
 * UI smoke tests: render the real frontend modules in jsdom against the real
 * backend. These exercise authentication, the dashboard and account settings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { startTestServer, createDom, waitFor, text } from '../helpers/dom-env.js';

let server;
let dom;
let app;

test.before(async () => {
  await freshStores();
  app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);
});

test.after(async () => {
  dom?.cleanup();
  await server?.close();
});

test('welcome screen renders sign-in form with security note', async () => {
  const { default: mountWelcome } = await import('../../frontend/assets/js/pages/welcome.js');
  const root = dom.document.getElementById('app');
  await mountWelcome(root, { container: root });
  await waitFor(() => dom.document.getElementById('auth-form'), { label: 'auth form' });
  const body = text(dom.document);
  assert.match(body, /Manage your Telegram bots without writing code/);
  assert.match(body, /Sign in/);
  assert.match(body, /never asks for your Telegram password/);
  assert.equal(dom.document.querySelectorAll('#email').length, 1);
});

test('account creation signs in and the dashboard shows honest empty state', async () => {
  const email = `ui-${Date.now()}@example.com`;
  dom.document.querySelector('[data-mode="signup"]').click();
  await waitFor(() => dom.document.getElementById('displayName'), { label: 'signup form' });
  dom.document.getElementById('displayName').value = 'UI Tester';
  dom.document.getElementById('email').value = email;
  dom.document.getElementById('password').value = 'a-strong-password';
  const { window } = dom;
  dom.document.getElementById('auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const { getState } = await import('../../frontend/assets/js/state.js');
  await waitFor(() => getState().user, { label: 'session' });
  assert.equal(getState().user.email, email);

  const token = window.localStorage.getItem('botforge.session');
  assert.ok(token, 'session token stored for the browser session');
  assert.equal(token.includes(':AA'), false, 'no bot token stored in the browser');

  const { default: mountDashboard } = await import('../../frontend/assets/js/pages/dashboard.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountDashboard(container);
  const body = container.textContent.replace(/\s+/g, ' ');
  assert.match(body, /Connected bots 0/);
  assert.match(body, /Getting started/);
  assert.match(body, /No executions yet/);
  assert.match(body, /No bots connected/);
  container.remove();
});

test('settings page renders profile, appearance and sign out', async () => {
  const { default: mountSettings } = await import('../../frontend/assets/js/pages/settings.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountSettings(container);
  const body = container.textContent;
  assert.match(body, /Account settings/);
  assert.match(body, /Sign-in method/);
  assert.ok(container.querySelector('#theme-group'));
  assert.ok(container.querySelector('#signout'));
  container.remove();
});

test('invalid credentials show an inline error instead of navigating', async () => {
  const { signOut } = await import('../../frontend/assets/js/auth.js');
  await signOut();
  window.location.hash = '#/login';
  const { default: mountWelcome } = await import('../../frontend/assets/js/pages/welcome.js');
  const root = dom.document.getElementById('app');
  await mountWelcome(root, { container: root });
  await waitFor(() => dom.document.getElementById('auth-form'), { label: 'auth form' });
  dom.document.querySelector('[data-mode="signin"]').click();
  await waitFor(() => !dom.document.getElementById('displayName'), { label: 'signin mode' });

  dom.document.getElementById('email').value = 'nobody@example.com';
  dom.document.getElementById('password').value = 'wrong-password';
  dom.document.getElementById('auth-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => dom.document.querySelector('#auth-error .alert--danger'), { label: 'error alert' });
  assert.match(dom.document.querySelector('#auth-error').textContent, /Incorrect email or password/);
});
