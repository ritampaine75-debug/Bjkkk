/**
 * UI coverage for the dual editor system: the same workflow is opened in Easy
 * Mode (forms) and Advanced Mode (canvas), edited, saved and published.
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
let workflowId;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  const app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);

  const reg = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'editor-ui@example.com', password: 'a-long-password-1', displayName: 'Editor' }),
  });
  const session = await reg.json();
  const client = await import('../../frontend/assets/js/api-client.js');
  client.setSessionToken(session.token);
  api = client.api;
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: session.user });

  const connect = await api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Editor Bot' });
  botId = connect.bot.id;
  const created = await api.post(`/bots/${botId}/workflows`, { template: 'welcome', name: 'Welcome workflow' });
  workflowId = created.workflow.id;
  try {
    dom.window.localStorage.setItem('botforge.editorMode', 'easy');
  } catch {
    /* ignore */
  }
});

test.after(async () => {
  mock?.restore();
  dom?.cleanup();
  await server?.close();
});

function lastDialog() {
  const dialogs = dom.document.querySelectorAll('dialog');
  return dialogs[dialogs.length - 1];
}

async function mountEditor(extra = {}) {
  // Unique ids per mount: stale pages would otherwise shadow descendant selectors.
  dom.document.body.replaceChildren();
  const { default: mount } = await import('../../frontend/assets/js/pages/workflow-editor.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mount(container, { params: { botId, workflowId }, query: { autosave: 'off', ...(extra.query || {}) } });
  return container;
}

test('Easy Mode renders the trigger, steps and validation state', async () => {
  const container = await mountEditor();
  await waitFor(() => container.querySelector('#wf-editor .card'), { label: 'form editor' });

  const text = container.textContent.replace(/\s+/g, ' ');
  assert.match(text, /Trigger/);
  assert.match(text, /Send a message with buttons/);
  assert.match(text, /Steps/);
  assert.match(text, /Validation passed/);
  assert.equal(container.querySelector('#easy-command').value, 'start');
  assert.equal(container.querySelector('[data-mode="easy"]').getAttribute('aria-pressed'), 'true');
  container.remove();
});

test('editing a step in Easy Mode marks the draft dirty and saves it', async () => {
  const container = await mountEditor();
  await waitFor(() => container.querySelector('[data-step-edit]'), { label: 'step editors' });

  container.querySelector('[data-step-edit=":0"]').click();
  const dialog = await waitFor(() => lastDialog(), { label: 'step dialog' });
  await waitFor(() => dialog.querySelector('#f-text'), { label: 'step fields' });
  const textarea = dialog.querySelector('#f-text');
  textarea.value = 'Hello and welcome from the Easy Mode editor.';
  dialog.querySelector('#step-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !lastDialog(), { label: 'dialog closed' });

  assert.equal(container.querySelector('#wf-save-state').textContent, 'Unsaved changes');

  container.querySelector('#wf-save').click();
  await waitFor(() => container.querySelector('#wf-save-state').textContent === 'Saved', { label: 'saved state' });

  const detail = await api.get(`/bots/${botId}/workflows/${workflowId}`);
  assert.equal(detail.workflow.draft.nodes[0].config.text, 'Hello and welcome from the Easy Mode editor.');
  assert.equal(detail.workflow.status, 'draft', 'saving a draft does not publish');
  container.remove();
});

test('undo restores the previous graph', async () => {
  const container = await mountEditor();
  await waitFor(() => container.querySelector('[data-step-edit]'), { label: 'form editor' });
  const before = container.querySelector('.form-step__body').textContent.trim();

  container.querySelector('[data-step-edit=":0"]').click();
  const dialog = await waitFor(() => lastDialog(), { label: 'step dialog' });
  await waitFor(() => dialog.querySelector('#f-text'), { label: 'step fields' });
  const textarea = dialog.querySelector('#f-text');
  textarea.value = 'Draft text that will be undone.';
  dialog.querySelector('#step-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !lastDialog(), { label: 'dialog closed' });
  assert.match(container.querySelector('.form-step__body').textContent, /Draft text that will be undone/);

  const undo = container.querySelector('#wf-undo');
  assert.equal(undo.disabled, false);
  undo.click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(container.querySelector('.form-step__body').textContent.trim(), before, 'graph restored by undo');
  assert.equal(container.querySelector('#wf-redo').disabled, false, 'redo becomes available');
  container.remove();
});

test('Advanced Mode renders the canvas with nodes and an inspector', async () => {
  const container = await mountEditor({ query: { mode: 'advanced' } });
  await waitFor(() => container.querySelector('.wf-canvas .wf-node'), { label: 'canvas nodes' });

  const nodes = container.querySelectorAll('.wf-node');
  assert.ok(nodes.length >= 3, `expected trigger + nodes, found ${nodes.length}`);
  assert.ok(container.querySelector('.wf-node--trigger'), 'trigger is drawn on the canvas');
  assert.ok(container.querySelectorAll('.wf-edge').length >= 2, 'edges are drawn');

  // Selecting a node opens its configuration in the inspector.
  const nodeEl = container.querySelector('.wf-node[data-node-kind="node"]');
  nodeEl.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  await waitFor(() => container.querySelector('#inspector-node-fields'), { label: 'inspector fields' });
  assert.match(container.querySelector('#wf-inspector-body').textContent, /Apply changes/);
  container.remove();
});

test('Advanced Mode can add a node and validate the result', async () => {
  const container = await mountEditor({ query: { mode: 'advanced' } });
  await waitFor(() => container.querySelector('.wf-canvas .wf-node'), { label: 'canvas' });
  const before = container.querySelectorAll('.wf-node').length;

  container.querySelector('#wf-add-node').click();
  await waitFor(() => container.querySelectorAll('.wf-node').length === before + 1, { label: 'node added' });
  assert.equal(container.querySelector('#wf-save-state').textContent, 'Unsaved changes');

  container.querySelector('#wf-validate').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  // The new text node is empty, so validation must report an error.
  assert.match(container.querySelector('#wf-validation').textContent, /error/i);
  container.remove();
});

test('publishing the workflow activates version 1', async () => {
  const container = await mountEditor({ query: { mode: 'easy' } });
  await waitFor(() => container.querySelector('#wf-publish'), { label: 'publish button' });
  container.querySelector('#wf-publish').click();

  const confirm = await waitFor(() => lastDialog(), { label: 'publish confirmation' });
  confirm.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  let detail = null;
  const started = Date.now();
  while (Date.now() - started < 5000) {
    detail = await api.get(`/bots/${botId}/workflows/${workflowId}`);
    if (detail.workflow.status === 'published') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(detail.workflow.publishedVersion, 1);
  container.remove();
});
