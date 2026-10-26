/**
 * UI coverage for Phase 6: webhook management on bot settings and the
 * guarded live test lab.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';
import { startTestServer, createDom, waitFor } from '../helpers/dom-env.js';

let server;
let dom;
let mock;
let botId;
let api;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  const app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);

  const reg = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'runtime-ui@example.com', password: 'a-long-password-1', displayName: 'RT' }),
  });
  const session = await reg.json();
  const client = await import('../../frontend/assets/js/api-client.js');
  client.setSessionToken(session.token);
  api = client.api;
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: session.user });

  const connect = await api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'RT Bot' });
  botId = connect.bot.id;
  const created = await api.post(`/bots/${botId}/workflows`, { template: 'welcome', name: 'Welcome' });
  await api.post(`/bots/${botId}/workflows/${created.workflow.id}/publish`, {});
});

test.after(async () => {
  mock?.restore();
  dom?.cleanup();
  await server?.close();
});

async function mountPage(modulePath) {
  // Drop previously mounted pages: duplicate ids would shadow each other when
  // descendant selectors resolve against the first match in the document.
  dom.document.body.replaceChildren();
  const { default: mount } = await import(modulePath);
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mount(container, { params: { botId } });
  return container;
}

const click = (node) => node.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

test('bot settings exposes the live runtime card and registers the webhook', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/bot-settings.js');
  await waitFor(() => container.querySelector('#runtime-card'), { label: 'runtime card' });
  assert.match(container.querySelector('#runtime-card').textContent, /Not registered|not registered/i);
  assert.ok(!container.querySelector('#webhook-remove'), 'no remove button before registration');

  click(container.querySelector('#webhook-register'));
  await waitFor(
    () => mock.calls.some((call) => call.method === 'setWebhook'),
    { label: 'Telegram setWebhook call' },
  );
  const call = mock.calls.filter((c) => c.method === 'setWebhook').at(-1);
  assert.match(call.payload.url, /\/api\/v1\/telegram\/webhook\//);
  assert.ok(call.payload.secret_token.length >= 24);
});

test('the routing probe reports matched workflows without sending anything', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/bot-settings.js');
  await waitFor(() => container.querySelector('#runtime-probe'), { label: 'probe button' });
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;
  click(container.querySelector('#runtime-probe'));
  await waitFor(() => container.querySelector('#runtime-feedback .alert'), { label: 'probe feedback' });
  assert.match(container.querySelector('#runtime-feedback').textContent, /Routing works: 1 workflow/);
  assert.equal(mock.calls.filter((c) => c.method === 'sendMessage').length, before);
});

test('the live test lab refuses to send until the confirmation is ticked', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/live-test.js');
  await waitFor(() => container.querySelector('#live-test-form'), { label: 'live test form' });
  container.querySelector('#chat-id').value = '777';
  container.querySelector('#message-text').value = 'Hello from the live lab';
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;

  container.querySelector('#live-test-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => container.querySelector('#live-feedback .alert'), { label: 'confirmation warning' });
  assert.match(container.querySelector('#live-feedback').textContent, /confirmation box/i);
  assert.equal(mock.calls.filter((c) => c.method === 'sendMessage').length, before);
});

test('a confirmed live test delivers exactly one real message', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/live-test.js');
  await waitFor(() => container.querySelector('#live-test-form'), { label: 'live test form' });
  container.querySelector('#chat-id').value = '777';
  container.querySelector('#message-text').value = 'Hello from the live lab';
  container.querySelector('#live-confirm').checked = true;
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;

  container.querySelector('#live-test-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => /Message delivered/.test(container.querySelector('#live-feedback').textContent), { label: 'delivery receipt' });
  const sent = mock.calls.filter((c) => c.method === 'sendMessage').slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.text, 'Hello from the live lab');
  assert.equal(String(sent[0].payload.chat_id), '777');
});

test('the live test lab shows the current runtime and published workflow state', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/live-test.js');
  await waitFor(() => container.querySelector('#live-runtime dl'), { label: 'runtime panel' });
  assert.match(container.querySelector('#live-runtime').textContent, /active/i);
  assert.match(container.textContent, /Welcome/);
});

test('an invalid chat id is rejected before any request is made', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/live-test.js');
  await waitFor(() => container.querySelector('#live-test-form'), { label: 'live test form' });
  container.querySelector('#chat-id').value = 'not-a-chat';
  container.querySelector('#live-confirm').checked = true;
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;
  container.querySelector('#live-test-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => container.querySelector('#live-feedback .alert'), { label: 'validation error' });
  assert.match(container.querySelector('#live-feedback').textContent, /numeric Telegram chat id/i);
  assert.equal(mock.calls.filter((c) => c.method === 'sendMessage').length, before);
});
