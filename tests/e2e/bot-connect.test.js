/**
 * End-to-end (jsdom + real backend + mocked Telegram) coverage of the connect
 * flow: connect a bot through the UI, see it listed, open its workspace and
 * inspect diagnostics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';
import { startTestServer, createDom, waitFor } from '../helpers/dom-env.js';

let server;
let dom;
let mock;
let app;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);

  // Register a session through the API so the UI can start authenticated.
  const res = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'e2e-bots@example.com', password: 'a-long-password-1', displayName: 'E2E' }),
  });
  const body = await res.json();
  const { setSessionToken } = await import('../../frontend/assets/js/api-client.js');
  setSessionToken(body.token);
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: body.user });
});

test.after(async () => {
  mock?.restore();
  dom?.cleanup();
  await server?.close();
});

test('empty bots page offers the connect action', async () => {
  const { default: mountBots } = await import('../../frontend/assets/js/pages/bots.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountBots(container);
  assert.match(container.textContent, /No bots connected/);
  assert.ok(container.querySelector('a[href="#/bots/connect"]'));
  container.remove();
});

test('connect form refuses to submit without the ownership acknowledgement', async () => {
  const { default: mountConnectBot } = await import('../../frontend/assets/js/pages/connect-bot.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountConnectBot(container);

  container.querySelector('#token').value = MOCK_TOKEN;
  const before = mock.calls.length;
  container.querySelector('#connect-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => container.querySelector('#connect-error .alert--danger'), { label: 'acknowledgement error' });
  assert.match(container.querySelector('#connect-error').textContent, /authorised/i);
  assert.equal(mock.calls.length, before, 'no Telegram call is made before acknowledgement');
  container.remove();
});

test('connecting a bot through the form stores it and clears the token input', async () => {
  const { default: mountConnectBot } = await import('../../frontend/assets/js/pages/connect-bot.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountConnectBot(container);

  container.querySelector('#token').value = MOCK_TOKEN;
  container.querySelector('#displayName').value = 'E2E Bot';
  container.querySelector('#environment').value = 'production';
  container.querySelector('#acknowledge').checked = true;
  container.querySelector('#connect-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => container.querySelector('#token').value === '', { label: 'token cleared' });
  assert.equal(container.querySelector('#token').value, '');

  // The stored session must never contain the bot token.
  assert.equal(JSON.stringify(dom.window.localStorage).includes('AAHdqTcv'), false);

  const { listBots } = await import('../../frontend/assets/js/services/bot-context.js');
  const bots = await listBots();
  assert.equal(bots.length, 1);
  assert.equal(bots[0].displayName, 'E2E Bot');
  assert.equal(bots[0].telegram.username, 'mock_bot');
  assert.equal(JSON.stringify(bots).includes('AAHdqTcv'), false);
  globalThis.__botId = bots[0].id;
  container.remove();
});

test('duplicate connect offers a link to the existing bot', async () => {
  const { default: mountConnectBot } = await import('../../frontend/assets/js/pages/connect-bot.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountConnectBot(container);

  container.querySelector('#token').value = MOCK_TOKEN;
  container.querySelector('#acknowledge').checked = true;
  container.querySelector('#connect-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => container.querySelector('#connect-error .alert--warning'), { label: 'duplicate warning' });
  const link = container.querySelector('#connect-error a');
  assert.ok(link, 'existing bot link is offered');
  assert.match(link.getAttribute('href'), new RegExp(globalThis.__botId));
  container.remove();
});

test('bot workspace renders metadata, counts and connection state', async () => {
  const { default: mountBotOverview } = await import('../../frontend/assets/js/pages/bot-overview.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountBotOverview(container, { params: { botId: globalThis.__botId } });

  const body = container.textContent.replace(/\s+/g, ' ');
  assert.match(body, /mock_bot/);
  assert.match(body, /7654321/);
  assert.match(body, /connected/);
  assert.match(body, /Workflows 0/);
  assert.match(body, /not_configured|not configured/);
  assert.equal(body.includes(MOCK_TOKEN), false);
  container.remove();
});

test('bot settings page hides the token and exposes diagnostics', async () => {
  const { default: mountBotSettings } = await import('../../frontend/assets/js/pages/bot-settings.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountBotSettings(container, { params: { botId: globalThis.__botId } });

  const body = container.textContent.replace(/\s+/g, ' ');
  assert.match(body, /Token & security/);
  assert.match(body, /AES-256-GCM/);
  assert.match(body, /Diagnostics/);
  assert.match(body, /Danger zone/);
  // Masked display only: the secret half of the token must not appear.
  assert.equal(container.innerHTML.includes('AAHdqTcv'), false);
  assert.equal(container.querySelector('#new-token').type, 'password');
  container.remove();
});
