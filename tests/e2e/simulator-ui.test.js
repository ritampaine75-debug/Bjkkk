/**
 * UI coverage for the Phase 5 simulator: chat rendering, inline keyboard
 * callback taps, branch tracing, variables and the execution log browser.
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
let workflowId;
let api;

const CALLBACK_GRAPH = {
  schemaVersion: 1,
  name: 'Menu flow',
  triggers: [{ id: 'trg_text', type: 'text', config: {} }],
  nodes: [
    {
      id: 'nd_menu',
      type: 'sendKeyboard',
      config: {
        text: 'Pick an option',
        keyboard: {
          rows: [
            [
              { text: 'Help', type: 'callback', value: 'help' },
              { text: 'About', type: 'callback', value: 'about' },
            ],
          ],
        },
      },
      position: { x: 0, y: 0 },
    },
    { id: 'nd_cond', type: 'condition', config: { subject: 'callbackData', operator: 'equals', value: 'help' }, position: { x: 0, y: 140 } },
    { id: 'nd_help', type: 'sendMessage', config: { text: 'Here is help' }, position: { x: -120, y: 280 } },
    { id: 'nd_about', type: 'sendMessage', config: { text: 'About this bot' }, position: { x: 120, y: 280 } },
  ],
  edges: [
    { id: 'e1', from: 'trg_text', to: 'nd_menu' },
    { id: 'e2', from: 'nd_menu', to: 'nd_cond' },
    { id: 'e3', from: 'nd_cond', to: 'nd_help', label: 'true' },
    { id: 'e4', from: 'nd_cond', to: 'nd_about', label: 'false' },
  ],
};

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  const app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);

  const reg = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'simulator-ui@example.com', password: 'a-long-password-1', displayName: 'Sim' }),
  });
  const session = await reg.json();
  const client = await import('../../frontend/assets/js/api-client.js');
  client.setSessionToken(session.token);
  api = client.api;
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: session.user });

  const connect = await api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Sim Bot' });
  botId = connect.bot.id;
  const created = await api.post(`/bots/${botId}/workflows`, { template: 'blank', name: 'Menu workflow' });
  workflowId = created.workflow.id;
  await api.put(`/bots/${botId}/workflows/${workflowId}`, { workflow: CALLBACK_GRAPH });
});

test.after(async () => {
  mock?.restore();
  dom?.cleanup();
  await server?.close();
});

async function mountPage(modulePath, params, query = {}) {
  // Unique ids per mount: stale pages would otherwise shadow descendant selectors.
  dom.document.body.replaceChildren();
  const { default: mount } = await import(modulePath);
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mount(container, { params, query });
  return container;
}

function send(container, text) {
  container.querySelector('#sim-text').value = text;
  const form = container.querySelector('#sim-form');
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

test('the simulator renders a chat, a step timeline and variables', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/simulator.js', { botId }, { workflow: workflowId });
  await waitFor(() => container.querySelector('#sim-form'), { label: 'simulator shell' });

  assert.match(container.querySelector('#sim-context').textContent, /Menu flow/);
  send(container, 'hello');

  await waitFor(() => container.querySelector('.sim-bubble--out'), { label: 'bot reply' });
  const bubbles = container.querySelectorAll('.sim-bubble');
  assert.ok(bubbles.length >= 3, 'inbound message, menu and branch reply');
  assert.match(container.querySelector('.sim-bubble--out').textContent, /Pick an option/);
  assert.equal(container.querySelectorAll('.sim-keyboard__btn').length, 2);
  assert.match(container.querySelector('.sim-summary').textContent, /succeeded/);
  assert.ok(container.querySelectorAll('.sim-step').length >= 3);
  assert.match(container.querySelector('.sim-branch').textContent, /false/, 'condition took the false branch');
  assert.doesNotMatch(container.querySelector('#sim-thread').textContent, /Here is help/);
  assert.match(container.querySelector('#sim-variables').textContent, /did not set any variables/);
});

test('tapping an inline keyboard button re-runs the workflow as a callback event', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/simulator.js', { botId }, { workflow: workflowId });
  await waitFor(() => container.querySelector('#sim-form'), { label: 'simulator shell' });
  send(container, 'hello');
  await waitFor(() => container.querySelector('[data-callback="help"]'), { label: 'inline keyboard' });

  container.querySelector('[data-callback="help"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await waitFor(() => /Here is help/.test(container.querySelector('#sim-thread').textContent), { label: 'help branch reply' });

  const branches = [...container.querySelectorAll('.sim-branch')].map((node) => node.textContent.trim());
  assert.equal(branches.at(-1), 'branch: true', 'the second run took the true branch');
});

test('a run with no matching trigger shows an actionable error instead of a fake reply', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/simulator.js', { botId }, { workflow: workflowId });
  await waitFor(() => container.querySelector('#sim-form'), { label: 'simulator shell' });
  // "hello" matches the text trigger; a callback with no callback trigger does not.
  send(container, 'hello');
  await waitFor(() => container.querySelector('.sim-bubble--out'), { label: 'bot reply' });

  // Point the page at a workflow that only listens for /start.
  const welcome = await api.post(`/bots/${botId}/workflows`, { template: 'welcome', name: 'Welcome only' });
  const second = await mountPage('../../frontend/assets/js/pages/simulator.js', { botId }, { workflow: welcome.workflow.id });
  await waitFor(() => second.querySelector('#sim-form'), { label: 'second simulator' });
  send(second, 'hello there');
  await waitFor(() => second.querySelector('.alert--danger'), { label: 'error alert' });
  assert.match(second.querySelector('.alert--danger').textContent, /No trigger|no trigger|matches/i);
  assert.equal(second.querySelectorAll('.sim-bubble--out').length, 0, 'no fabricated replies');
});

test('the reset button clears the conversation and results', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/simulator.js', { botId }, { workflow: workflowId });
  await waitFor(() => container.querySelector('#sim-form'), { label: 'simulator shell' });
  send(container, 'hello');
  await waitFor(() => container.querySelector('.sim-bubble--out'), { label: 'bot reply' });

  container.querySelector('#sim-reset').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await waitFor(() => container.querySelector('.sim-empty'), { label: 'empty chat' });
  assert.equal(container.querySelectorAll('.sim-bubble').length, 0);
  assert.equal(container.querySelector('#sim-run').innerHTML, '');
});

test('every simulated run lands in the execution log browser', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/executions.js', { botId }, {});
  await waitFor(() => container.querySelector('.exec-list'), { label: 'execution list' });
  const rows = container.querySelectorAll('[data-execution]');
  assert.ok(rows.length >= 1, 'simulated runs are listed');
  assert.match(container.textContent, /simulated/);

  rows[0].dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await waitFor(() => dom.document.querySelector('#exec-detail .sim-steps'), { label: 'execution detail' });
  const detail = dom.document.querySelector('#exec-detail');
  assert.ok(detail.querySelectorAll('.sim-step').length >= 1);
  assert.match(detail.textContent, /Conversation/);
  [...dom.document.querySelectorAll('dialog')].forEach((dialog) => dialog.remove());
});

test('the status filter narrows the log to failed runs and shows an honest empty state', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/executions.js', { botId }, { status: 'failed' });
  await waitFor(() => container.querySelector('.empty, .exec-list'), { label: 'executions body' });
  const empty = container.querySelector('.empty');
  assert.ok(empty, 'no failed runs were recorded yet');
  assert.match(empty.textContent, /No executions with status failed/);
});
