/** UI flow: create a /start command with an inline keyboard, toggle, sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';
import { startTestServer, createDom, waitFor } from '../helpers/dom-env.js';

let server;
let dom;
let mock;
let botId;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  const app = await makeApp();
  server = await startTestServer(app);
  dom = await createDom(server.baseUrl);

  const reg = await fetch(`${server.baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cmd-ui@example.com', password: 'a-long-password-1', displayName: 'Cmd UI' }),
  });
  const session = await reg.json();
  const { setSessionToken, api } = await import('../../frontend/assets/js/api-client.js');
  setSessionToken(session.token);
  const { setState } = await import('../../frontend/assets/js/state.js');
  setState({ user: session.user });
  const connect = await api.post('/bots/connect', { token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Cmd UI Bot' });
  botId = connect.bot.id;
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

async function mountCommandsPage() {
  // Unique ids per mount: stale pages would otherwise shadow descendant selectors.
  dom.document.body.replaceChildren();
  const { default: mountCommands } = await import('../../frontend/assets/js/pages/commands.js');
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  await mountCommands(container, { params: { botId } });
  return container;
}

test('commands page starts with an honest empty state', async () => {
  const container = await mountCommandsPage();
  assert.match(container.textContent, /No commands yet/);
  assert.match(container.textContent, /Never synced to Telegram/);
  container.remove();
});

test('creating /start with an inline keyboard through the editor', async () => {
  const container = await mountCommandsPage();
  container.querySelector('#empty-new-command').click();

  const editor = await waitFor(() => lastDialog(), { label: 'command editor' });
  await waitFor(() => editor.querySelector('#cmd-name'), { label: 'editor fields' });
  assert.equal(editor.querySelector('#cmd-name').value, 'start');

  editor.querySelector('#cmd-description').value = 'Show the welcome menu';
  const reply = editor.querySelector('#cmd-reply');
  reply.value = 'Welcome to BotForge Demo Bot.\n\nChoose an option below.';
  reply.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  // Add a keyboard row with three buttons: Help / About / Contact.
  editor.querySelector('#add-row').click();
  let rows = editor.querySelectorAll('[data-button-field$=":text"]');
  assert.equal(rows.length, 1);
  const labels = ['Help', 'About', 'Contact'];
  labels.forEach((label, index) => {
    if (index > 0) editor.querySelector('[data-add-button="0"]').click();
    const input = editor.querySelectorAll('[data-button-field="0:' + index + ':text"]')[0];
    input.value = label;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const valueInput = editor.querySelector(`[data-button-field="0:${index}:value"]`);
    valueInput.value = label.toLowerCase();
    valueInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  // Preview reflects the draft before saving.
  assert.match(editor.querySelector('#preview-keyboard').textContent, /Help/);

  editor.querySelector('#command-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !lastDialog(), { label: 'editor closed' });
  await waitFor(() => container.textContent.includes('/start'), { label: 'command listed' });

  assert.match(container.textContent, /Show the welcome menu/);
  assert.match(container.textContent, /3 buttons/);
  assert.match(container.textContent, /Local changes not published to Telegram/);
  container.remove();
});

test('invalid command names surface field errors without closing the editor', async () => {
  const container = await mountCommandsPage();
  container.querySelector('#new-command').click();
  const editor = await waitFor(() => lastDialog(), { label: 'editor' });
  await waitFor(() => editor.querySelector('#cmd-name'), { label: 'fields' });
  const nameInput = editor.querySelector('#cmd-name');
  nameInput.value = 'Bad Name!';
  nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  editor.querySelector('#command-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => editor.querySelector('#command-errors .alert--danger'), { label: 'validation errors' });
  assert.match(editor.querySelector('#command-errors').textContent, /lowercase letters, digits and underscores/i);
  editor.querySelector('[data-close]').click();
  await waitFor(() => !lastDialog(), { label: 'editor closed' });
  container.remove();
});

test('disabling a command updates the stored state', async () => {
  const container = await mountCommandsPage();
  const toggle = container.querySelector('[data-toggle-command]');
  assert.ok(toggle.checked);
  toggle.checked = false;
  toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await waitFor(() => false || container.textContent.includes('disabled'), { label: 'disabled badge' }).catch(() => {});
  const { default: mountCommands } = await import('../../frontend/assets/js/pages/commands.js');
  const fresh = dom.document.createElement('div');
  dom.document.body.appendChild(fresh);
  await mountCommands(fresh, { params: { botId } });
  assert.match(fresh.textContent, /disabled/);
  assert.equal(fresh.querySelector('[data-toggle-command]').checked, false);
  fresh.remove();
  container.remove();
});

test('syncing to Telegram asks for confirmation and calls setMyCommands once', async () => {
  const container = await mountCommandsPage();
  // Re-enable so the payload is not empty.
  const toggle = container.querySelector('[data-toggle-command]');
  if (!toggle.checked) {
    toggle.checked = true;
    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  }
  const before = mock.callsFor('setMyCommands').length;

  container.querySelector('#sync-commands').click();
  const confirm = await waitFor(() => lastDialog(), { label: 'confirm dialog' });
  assert.match(confirm.textContent, /Replace the Telegram command menu/);
  assert.match(confirm.textContent, /\/start/);
  confirm.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  await waitFor(() => mock.callsFor('setMyCommands').length > before, { label: 'sync call' });
  const call = mock.callsFor('setMyCommands').at(-1);
  assert.deepEqual(call.payload.commands, [{ command: 'start', description: 'Show the welcome menu' }]);
  container.remove();
});
