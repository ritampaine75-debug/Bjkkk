/**
 * UI coverage for Phase 7: schedules, user restrictions and analytics.
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
let scheduleWorkflowId;

const click = (node) => node.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  server = await startTestServer(await makeApp());
  dom = await createDom(server.baseUrl);
  const reg = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'advanced-ui@example.com', password: 'a-long-password-1' }),
  });
  const session = await reg.json();
  const client = await import('../../frontend/assets/js/api-client.js');
  client.setSessionToken(session.token);
  api = client.api;
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: session.user });

  botId = (await api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Advanced UI Bot' })).bot.id;
  const created = await api.post(`/bots/${botId}/workflows`, { template: 'blank', name: 'Interval' });
  scheduleWorkflowId = created.workflow.id;
  await api.put(`/bots/${botId}/workflows/${scheduleWorkflowId}`, {
    workflow: {
      schemaVersion: 1,
      name: 'Interval',
      triggers: [{ id: 'trg_sched', type: 'schedule', config: { intervalMinutes: 30 } }],
      nodes: [{ id: 'nd_log', type: 'logEvent', config: { message: 'tick' }, position: { x: 0, y: 0 } }],
      edges: [{ id: 'e1', from: 'trg_sched', to: 'nd_log' }],
    },
  });
  await api.post(`/bots/${botId}/workflows/${scheduleWorkflowId}/publish`, {});
  await api.post(`/bots/${botId}/runtime/simulate-update`, { text: '/start', dryRun: true });
});

test.after(async () => {
  mock?.restore();
  dom?.cleanup();
  await server?.close();
});

async function mountPage(modulePath, query = {}) {
  dom.document.body.replaceChildren();
  const { default: mount } = await import(modulePath);
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mount(container, { params: { botId }, query });
  return container;
}

test('the schedules page lists interval triggers with next-run information', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/schedules.js');
  await waitFor(() => container.querySelector('[data-run]'), { label: 'schedule rows' });
  const text = container.textContent.replace(/\s+/g, ' ');
  assert.match(text, /Interval/);
  assert.match(text, /every 30 min/);
  assert.match(text, /Scheduler disabled on this deployment/);
  assert.match(text, /Run now/);
});

test('"Run now" executes the schedule and reports the outcome', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/schedules.js');
  await waitFor(() => container.querySelector('[data-run]'), { label: 'schedule rows' });
  click(container.querySelector('[data-run]'));
  await waitFor(() => /last .*succeeded/i.test(container.textContent.replace(/\s+/g, ' ')), { label: 'run result' });
  const executions = await api.get(`/bots/${botId}/executions?limit=5`);
  assert.ok(executions.executions.some((row) => row.triggerType === 'schedule'));
});

test('user restrictions can be saved from bot settings', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/bot-settings.js');
  await waitFor(() => container.querySelector('#restrictions-form'), { label: 'restrictions form' });
  container.querySelector('#restrictions-mode').value = 'allowlist';
  container.querySelector('#restrictions-ids').value = '111, 222';
  container.querySelector('#restrictions-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => /Only these user IDs/.test(container.textContent), { label: 'saved restrictions' });
  const detail = await api.get(`/bots/${botId}`);
  assert.equal(detail.bot.restrictions.mode, 'allowlist');
  assert.deepEqual(detail.bot.restrictions.userIds, ['111', '222']);
  await api.patch(`/bots/${botId}/restrictions`, { mode: 'everyone', userIds: [] });
});

test('invalid restrictions show an inline error instead of silently saving', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/bot-settings.js');
  await waitFor(() => container.querySelector('#restrictions-form'), { label: 'restrictions form' });
  container.querySelector('#restrictions-mode').value = 'allowlist';
  container.querySelector('#restrictions-ids').value = 'not-an-id';
  container.querySelector('#restrictions-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => container.querySelector('#restrictions-feedback .alert'), { label: 'restriction error' });
  assert.match(container.querySelector('#restrictions-feedback').textContent, /numeric/i);
});

test('analytics summarise real runs and render a daily chart', async () => {
  const container = await mountPage('../../frontend/assets/js/pages/executions.js');
  await waitFor(() => container.querySelector('.analytics-chart, .analytics-body, #analytics-body .empty'), {
    label: 'analytics panel',
  });
  const body = container.querySelector('#analytics-body');
  assert.match(body.textContent, /Runs/);
  assert.match(body.textContent, /Success rate/);
  assert.ok(body.querySelectorAll('.analytics-bar').length >= 7);
  assert.match(body.textContent, /Interval/);
});

test('analytics for a bot without runs are empty rather than fabricated', async () => {
  // A separate account owns a bot workspace with no executions at all.
  const other = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'empty-ui@example.com', password: 'a-long-password-1' }),
  });
  const session = await other.json();
  const otherClient = await import('../../frontend/assets/js/api-client.js');
  const previous = otherClient.getSessionToken();
  otherClient.setSessionToken(session.token);
  const bot = await otherClient.api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Empty' });
  const res = await otherClient.api.get(`/bots/${bot.bot.id}/analytics`);
  otherClient.setSessionToken(previous);
  assert.equal(res.analytics.totals.runs, 0);
  assert.equal(res.analytics.totals.successRate, null);
  assert.deepEqual(res.analytics.workflows, []);
  assert.equal(res.analytics.duration.p50Ms, null);
});
