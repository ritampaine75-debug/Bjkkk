import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';

let app;
let token;
let botId;
let workflowId;
let mock;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'simulator@example.com', password: 'a-long-password-1', displayName: 'Sim' })
    .expect(201);
  token = reg.body.token;
  const connect = await request(app)
    .post('/api/v1/bots/connect')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Simulator Bot' })
    .expect(201);
  botId = connect.body.bot.id;
  const wf = await request(app)
    .post(`/api/v1/bots/${botId}/workflows`)
    .set('Authorization', `Bearer ${token}`)
    .send({ template: 'welcome' })
    .expect(201);
  workflowId = wf.body.workflow.id;
});

test.after(() => mock.restore());
const auth = (req) => req.set('Authorization', `Bearer ${token}`);

test('simulating /start runs the real workflow against a mock transport', async () => {
  const beforeCalls = mock.calls.length;
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/simulate`))
    .send({ workflowId, event: { type: 'text', text: '/start' } })
    .expect(200);

  assert.equal(res.body.execution.status, 'succeeded');
  assert.equal(res.body.execution.mode, 'simulation');
  assert.equal(res.body.trigger.type, 'command');
  assert.equal(res.body.steps.length, 2);
  assert.equal(res.body.steps[0].type, 'sendKeyboard');
  assert.equal(res.body.steps[0].output.buttonCount, 3);
  assert.equal(res.body.transcript.length, 2, 'inbound + outbound messages');
  assert.equal(res.body.transcript[0].direction, 'in');
  assert.equal(res.body.transcript[1].direction, 'out');
  assert.match(res.body.transcript[1].text, /Welcome to BotForge Demo Bot/);
  assert.equal(res.body.transcript[1].keyboard.length, 2);
  assert.match(res.body.label, /no Telegram messages were sent/);
  assert.equal(mock.calls.length, beforeCalls, 'simulation never touches Telegram');
  globalThis.__execId = res.body.execution.id;
});

test('the simulator executes the saved workflow, not hardcoded output', async () => {
  const detail = await auth(request(app).get(`/api/v1/bots/${botId}/workflows/${workflowId}`)).expect(200);
  const graph = detail.body.workflow.draft;
  graph.nodes[0].config.text = 'Edited in the draft editor';
  await auth(request(app).put(`/api/v1/bots/${botId}/workflows/${workflowId}`)).send({ workflow: graph }).expect(200);

  const res = await auth(request(app).post(`/api/v1/bots/${botId}/simulate`))
    .send({ workflowId, event: { text: '/start' } })
    .expect(200);
  assert.equal(res.body.transcript[1].text, 'Edited in the draft editor');
});

test('inputs without a matching trigger produce a helpful error', async () => {
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/simulate`))
    .send({ workflowId, event: { text: 'not a command' } })
    .expect(422);
  assert.equal(res.body.error.code, 'no_matching_trigger');
  assert.match(res.body.error.message, /\/start/);
});

test('invalid workflows cannot be simulated', async () => {
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`)).send({ template: 'blank' }).expect(201);
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/simulate`))
    .send({ workflowId: created.body.workflow.id, event: { text: '/start' } })
    .expect(422);
  assert.equal(res.body.error.code, 'validation_failed');
  assert.ok(res.body.error.details.length > 0);
});

test('callback simulation matches the callback trigger and answers it', async () => {
  const graph = {
    schemaVersion: 1,
    name: 'Callback flow',
    triggers: [{ id: 'trg_cb', type: 'callback', config: { matchAny: true } }],
    nodes: [
      { id: 'nd_answer', type: 'answerCallback', config: { text: 'Thanks!', showAlert: false }, position: { x: 0, y: 0 } },
      { id: 'nd_msg', type: 'sendMessage', config: { text: 'You tapped {{callbackData}}' }, position: { x: 0, y: 140 } },
    ],
    edges: [
      { id: 'e1', from: 'trg_cb', to: 'nd_answer' },
      { id: 'e2', from: 'nd_answer', to: 'nd_msg' },
    ],
  };
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`))
    .send({ template: 'blank', name: 'Callback flow' })
    .expect(201);
  const id = created.body.workflow.id;
  await auth(request(app).put(`/api/v1/bots/${botId}/workflows/${id}`)).send({ workflow: graph }).expect(200);

  const res = await auth(request(app).post(`/api/v1/bots/${botId}/simulate`))
    .send({ workflowId: id, event: { type: 'callback', callbackData: 'help' } })
    .expect(200);
  assert.equal(res.body.trigger.type, 'callback');
  assert.equal(res.body.execution.status, 'succeeded');
  assert.equal(res.body.transcript.at(-1).text, 'You tapped help');
});

test('execution history records the simulation with steps and transcript', async () => {
  const list = await auth(request(app).get(`/api/v1/bots/${botId}/executions`)).expect(200);
  assert.ok(list.body.executions.length >= 2);
  const summary = list.body.executions.find((execution) => execution.id === globalThis.__execId);
  assert.equal(summary.mode, 'simulation');
  assert.equal(summary.status, 'succeeded');
  assert.ok(summary.stepCount >= 2);

  const detail = await auth(request(app).get(`/api/v1/bots/${botId}/executions/${globalThis.__execId}`)).expect(200);
  assert.ok(detail.body.execution.steps.length >= 2);
  assert.equal(detail.body.execution.simulated, true);
  assert.ok(Array.isArray(detail.body.execution.transcript));
});

test('execution list paginates and filters by status', async () => {
  const page = await auth(request(app).get(`/api/v1/bots/${botId}/executions?limit=1`)).expect(200);
  assert.equal(page.body.executions.length, 1);
  assert.equal(page.body.pagination.hasMore, true);
  assert.equal(page.body.pagination.nextOffset, 1);

  const failed = await auth(request(app).get(`/api/v1/bots/${botId}/executions?status=failed`)).expect(200);
  assert.equal(failed.body.executions.length, 0);
});

test('scenarios can be saved, listed and removed', async () => {
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/simulate/scenarios`))
    .send({ name: 'Start conversation', workflowId, events: [{ type: 'text', text: '/start' }] })
    .expect(201);
  const list = await auth(request(app).get(`/api/v1/bots/${botId}/simulate/scenarios`)).expect(200);
  assert.equal(list.body.scenarios.length, 1);
  assert.equal(list.body.scenarios[0].name, 'Start conversation');
  await auth(request(app).delete(`/api/v1/bots/${botId}/simulate/scenarios/${created.body.scenario.id}`)).expect(204);
  const after = await auth(request(app).get(`/api/v1/bots/${botId}/simulate/scenarios`)).expect(200);
  assert.equal(after.body.scenarios.length, 0);
});

test('another user cannot simulate this bot', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'sim-intruder@example.com', password: 'another-long-password' })
    .expect(201);
  await request(app)
    .post(`/api/v1/bots/${botId}/simulate`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ workflowId, event: { text: '/start' } })
    .expect(404);
});

test('simulation records never store the bot token', async () => {
  const list = await auth(request(app).get(`/api/v1/bots/${botId}/executions?limit=50`)).expect(200);
  for (const execution of list.body.executions) {
    const detail = await auth(request(app).get(`/api/v1/bots/${botId}/executions/${execution.id}`)).expect(200);
    assert.equal(JSON.stringify(detail.body).includes('AAHdqTcv'), false);
  }
});
