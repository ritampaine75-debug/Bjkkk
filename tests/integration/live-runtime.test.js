import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';

let app;
let token;
let botId;
let workflowId;
let webhookPath;
let mock;
let runtimeQueue;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

function telegramCalls(method) {
  return mock.calls.filter((call) => call.method === method);
}

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  ({ runtimeQueue } = await import('../../backend/src/services/live-runtime.js'));

  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'runtime@example.com', password: 'a-long-password-1', displayName: 'Runtime' })
    .expect(201);
  token = reg.body.token;
  const connect = await auth(request(app).post('/api/v1/bots/connect')).send({
    token: MOCK_TOKEN,
    acknowledgeOwnership: true,
    displayName: 'Runtime Bot',
  }).expect(201);
  botId = connect.body.bot.id;

  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`)).send({ template: 'welcome' }).expect(201);
  workflowId = created.body.workflow.id;
  await auth(request(app).post(`/api/v1/bots/${botId}/workflows/${workflowId}/publish`)).send({}).expect(200);
});

test.after(() => mock.restore());

test('registering a webhook calls Telegram with a secret token and stores only a hash', async () => {
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/webhook`)).send({}).expect(201);
  const call = telegramCalls('setWebhook').at(-1);
  assert.ok(call, 'setWebhook was called');
  assert.match(call.payload.url, /^https:\/\/bots\.example\.test\/api\/v1\/telegram\/webhook\/.+\/.+$/);
  assert.ok(call.payload.secret_token && call.payload.secret_token.length >= 24);
  assert.deepEqual(call.payload.allowed_updates, ['message', 'edited_message', 'callback_query']);
  assert.equal(res.body.webhook.state, 'active');
  assert.match(res.body.webhook.url, /•/, 'the returned URL is masked');
  assert.equal(res.body.webhook.secretTokenConfigured, true);

  const status = await auth(request(app).get(`/api/v1/bots/${botId}/webhook`)).expect(200);
  assert.equal(status.body.webhook.routeRegistered, true);
  assert.equal(status.body.webhook.telegram.url.startsWith('https://bots.example.test'), true);

  webhookPath = new URL(call.payload.url).pathname;
});

test('a delivered update runs the published workflow with real Telegram calls', async () => {
  const before = telegramCalls('sendMessage').length;
  const res = await request(app)
    .post(webhookPath)
    .set('X-Telegram-Bot-Api-Secret-Token', webhookPath.split('/').pop())
    .send({
      update_id: 900,
      message: {
        message_id: 12,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private' },
        from: { id: 777, is_bot: false, first_name: 'Real', username: 'real_user' },
        text: '/start',
      },
    })
    .expect(200);
  assert.equal(res.body.ok, true);

  await runtimeQueue.drain(5000);
  assert.equal(telegramCalls('sendMessage').length, before + 1, 'one live message sent');

  const executions = await auth(request(app).get(`/api/v1/bots/${botId}/executions`)).expect(200);
  const live = executions.body.executions.find((row) => row.mode === 'live');
  assert.ok(live, 'a live execution was recorded');
  assert.equal(live.status, 'succeeded');
  assert.equal(live.triggerType, 'command');
  assert.equal(live.simulated, false);
});

test('the same update id is processed exactly once', async () => {
  const before = telegramCalls('sendMessage').length;
  const payload = {
    update_id: 901,
    message: {
      message_id: 13,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false, first_name: 'Real' },
      text: '/start',
    },
  };
  await request(app).post(webhookPath).send(payload).expect(200);
  await runtimeQueue.drain(5000);
  await request(app).post(webhookPath).send(payload).expect(200);
  await runtimeQueue.drain(5000);
  assert.equal(telegramCalls('sendMessage').length, before + 1, 'the duplicate was rejected');
});

test('updates with no matching published workflow are accepted but do nothing', async () => {
  const before = telegramCalls('sendMessage').length;
  const res = await request(app)
    .post(webhookPath)
    .send({ update_id: 902, message: { message_id: 1, chat: { id: 5 }, from: { id: 5 }, text: 'unrelated chatter' } })
    .expect(200);
  assert.equal(res.body.ok, true);
  await runtimeQueue.drain(5000);
  assert.equal(telegramCalls('sendMessage').length, before);
});

test('an invalid capability key is rejected and never executed', async () => {
  const before = telegramCalls('sendMessage').length;
  const bad = webhookPath.replace(/[^/]+$/, 'not-a-valid-key-000000000000');
  const res = await request(app).post(bad).send({ update_id: 903, message: { message_id: 1, chat: { id: 5 }, text: '/start' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'invalid_webhook_key');
  await runtimeQueue.drain(5000);
  assert.equal(telegramCalls('sendMessage').length, before);
});

test('a mismatched secret token header is rejected', async () => {
  const res = await request(app)
    .post(webhookPath)
    .set('X-Telegram-Bot-Api-Secret-Token', 'definitely-the-wrong-secret')
    .send({ update_id: 904, message: { message_id: 1, chat: { id: 5 }, text: '/start' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'invalid_webhook_secret');
});

test('a rate-limited send is retried and the execution still succeeds', async () => {
  mock.state.failNext = { method: 'sendMessage', status: 429, description: 'Too Many Requests', retryAfter: 1 };
  const res = await request(app).post(webhookPath).send({
    update_id: 905,
    message: { message_id: 14, chat: { id: 777 }, from: { id: 777, first_name: 'Real' }, text: '/start' },
  });
  assert.equal(res.status, 200);
  await runtimeQueue.drain(15000);

  const executions = await auth(request(app).get(`/api/v1/bots/${botId}/executions?limit=5`)).expect(200);
  const recent = executions.body.executions[0];
  assert.equal(recent.status, 'succeeded');
  assert.equal(recent.retryCount, 1, 'the retry is recorded on the execution');
});

test('the runtime endpoint reports queue state and recent activity', async () => {
  const res = await auth(request(app).get(`/api/v1/bots/${botId}/runtime`)).expect(200);
  assert.equal(typeof res.body.runtime.queue.pending, 'number');
  assert.ok(res.body.runtime.processedUpdates >= 1);
  assert.equal(res.body.bot.webhook.state, 'active');
  assert.ok(Array.isArray(res.body.runtime.recentEvents));
});

test('runtime/simulate-update exercises routing without touching Telegram', async () => {
  const before = telegramCalls('sendMessage').length;
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/runtime/simulate-update`))
    .send({ text: '/start', updateId: 12345 })
    .expect(200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.matched, 1);
  assert.equal(res.body.executions[0].status, 'succeeded');
  assert.equal(telegramCalls('sendMessage').length, before, 'no real Telegram call');
});

test('the live test lab refuses to message without explicit confirmation', async () => {
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/live-test`)).send({ chatId: '777', text: 'hi' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /confirm/);

  const badChat = await auth(request(app).post(`/api/v1/bots/${botId}/live-test`))
    .send({ chatId: 'not-a-number', text: 'hi', confirm: true });
  assert.equal(badChat.status, 400);
});

test('the live test lab delivers one real message through the transport', async () => {
  const before = telegramCalls('sendMessage').length;
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/live-test`))
    .send({ chatId: '777', text: 'Live test from BotForge', confirm: true })
    .expect(200);
  assert.equal(res.body.delivered, true);
  assert.equal(telegramCalls('sendMessage').length, before + 1);
  assert.match(telegramCalls('sendMessage').at(-1).payload.text, /Live test/);
});

test('removing the webhook clears local state and tells Telegram', async () => {
  const res = await auth(request(app).delete(`/api/v1/bots/${botId}/webhook`)).expect(200);
  assert.equal(res.body.webhook.state, 'not_configured');
  assert.ok(telegramCalls('deleteWebhook').length >= 1);
  const status = await auth(request(app).get(`/api/v1/bots/${botId}/webhook`)).expect(200);
  assert.equal(status.body.webhook.routeRegistered, false);

  // The old capability URL stops working immediately.
  const after = await request(app).post(webhookPath).send({ update_id: 999, message: { message_id: 1, chat: { id: 5 }, text: '/start' } });
  assert.equal(after.status, 401);
});
