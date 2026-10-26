/**
 * Live runtime fallback: stored command replies answer when no published
 * workflow owns the command, and never shadow a workflow trigger.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';

let app;
let token;
let botId;
let mock;
let processUpdate;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

function update(text, id = Math.floor(Math.random() * 1e6)) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 4242, type: 'private' },
      from: { id: 4242, is_bot: false, first_name: 'Tester', username: 'tester' },
      text,
    },
  };
}

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  ({ processUpdate } = await import('../../backend/src/services/live-runtime.js'));
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'command-replies@example.com', password: 'a-long-password-1' })
    .expect(201);
  token = reg.body.token;
  const connect = await auth(request(app).post('/api/v1/bots/connect')).send({
    token: MOCK_TOKEN,
    acknowledgeOwnership: true,
  }).expect(201);
  botId = connect.body.bot.id;

  await auth(request(app).post(`/api/v1/bots/${botId}/commands`)).send({
    name: 'help',
    description: 'Show help',
    reply: { text: 'Here is how I can help.' },
    keyboard: { rows: [[{ text: 'Docs', type: 'url', value: 'https://example.com/docs' }]] },
  }).expect(201);
  await auth(request(app).post(`/api/v1/bots/${botId}/commands`)).send({
    name: 'off',
    description: 'Disabled command',
    enabled: false,
    reply: { text: 'You should never see this.' },
  }).expect(201);
});

test.after(() => mock.restore());

test('an enabled command without a workflow is answered live', async () => {
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;
  const summary = await processUpdate({ uid: (await auth(request(app).get('/api/v1/auth/me')).expect(200)).body.user.uid, botId, update: update('/help') });

  assert.equal(summary.matched, 0);
  assert.equal(summary.executions.length, 1);
  assert.equal(summary.executions[0].source, 'command');
  assert.equal(summary.executions[0].status, 'succeeded');

  const sent = mock.calls.filter((c) => c.method === 'sendMessage').slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.text, 'Here is how I can help.');
  assert.equal(String(sent[0].payload.chat_id), '4242');
  assert.equal(sent[0].payload.reply_markup.inline_keyboard[0][0].url, 'https://example.com/docs');
});

test('a disabled command is ignored', async () => {
  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;
  const me = await auth(request(app).get('/api/v1/auth/me')).expect(200);
  const summary = await processUpdate({ uid: me.body.user.uid, botId, update: update('/off') });
  assert.equal(summary.matched, 0);
  assert.deepEqual(summary.executions, []);
  assert.equal(mock.calls.filter((c) => c.method === 'sendMessage').length, before);
});

test('a published workflow wins over the stored command reply', async () => {
  const me = await auth(request(app).get('/api/v1/auth/me')).expect(200);
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`)).send({ template: 'welcome' }).expect(201);
  await auth(request(app).post(`/api/v1/bots/${botId}/workflows/${created.body.workflow.id}/publish`)).send({}).expect(200);

  const before = mock.calls.filter((c) => c.method === 'sendMessage').length;
  const summary = await processUpdate({ uid: me.body.user.uid, botId, update: update('/start', 5150) });
  assert.equal(summary.matched, 1);
  assert.equal(summary.executions.length, 1, 'only the workflow ran');
  assert.equal(summary.executions[0].source, undefined);
  const sent = mock.calls.filter((c) => c.method === 'sendMessage').slice(before);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.text, /Welcome to BotForge Demo Bot/);
});

test('command replies show up in the execution log', async () => {
  const list = await auth(request(app).get(`/api/v1/bots/${botId}/executions?limit=20`)).expect(200);
  const reply = list.body.executions.find((row) => /\/help command reply/.test(row.workflowName || ''));
  assert.ok(reply, 'the command reply execution is listed');
  assert.equal(reply.mode, 'live');
  assert.equal(reply.status, 'succeeded');
});
