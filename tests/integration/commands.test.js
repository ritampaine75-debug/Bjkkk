import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';

let app;
let token;
let botId;
let mock;

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'commands@example.com', password: 'a-long-password-1', displayName: 'Cmd' })
    .expect(201);
  token = reg.body.token;
  const connect = await request(app)
    .post('/api/v1/bots/connect')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Commands Bot' })
    .expect(201);
  botId = connect.body.bot.id;
});

test.after(() => mock.restore());

const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const base = () => `/api/v1/bots/${botId}/commands`;

test('a new bot has no commands and reports never_synced', async () => {
  const res = await auth(request(app).get(base())).expect(200);
  assert.deepEqual(res.body.commands, []);
  assert.equal(res.body.sync.state, 'never_synced');
});

test('creating a /start command with reply and inline keyboard', async () => {
  const res = await auth(request(app).post(base()))
    .send({
      name: '/start',
      description: 'Show the welcome menu',
      reply: { text: 'Welcome to BotForge Demo Bot.\n\nChoose an option below.' },
      keyboard: {
        rows: [
          [{ text: 'Help', type: 'callback', value: 'help' }],
          [
            { text: 'About', type: 'callback', value: 'about' },
            { text: 'Contact', type: 'callback', value: 'contact' },
          ],
        ],
      },
    })
    .expect(201);

  const command = res.body.command;
  assert.equal(command.name, 'start');
  assert.equal(command.enabled, true);
  assert.equal(command.keyboard.rows.length, 2);
  assert.equal(res.body.sync.state, 'pending_changes');
  globalThis.__cmdId = command.id;
});

test('invalid command names and payloads are rejected with field errors', async () => {
  const badName = await auth(request(app).post(base()))
    .send({ name: 'Bad Name!', description: 'x' })
    .expect(422);
  assert.equal(badName.body.error.code, 'validation_failed');
  assert.ok(badName.body.error.details.some((d) => d.field === 'name'));

  const duplicate = await auth(request(app).post(base())).send({ name: 'start' }).expect(422);
  assert.ok(duplicate.body.error.details.some((d) => d.field === 'name'));

  const longDescription = await auth(request(app).post(base()))
    .send({ name: 'help', description: 'x'.repeat(300) })
    .expect(422);
  assert.ok(longDescription.body.error.details.some((d) => d.field === 'description'));

  const badUrl = await auth(request(app).post(base()))
    .send({ name: 'docs', keyboard: { rows: [[{ text: 'Docs', type: 'url', value: 'javascript:alert(1)' }]] } })
    .expect(422);
  assert.ok(badUrl.body.error.details.some((d) => d.field.includes('value')));
});

test('commands can be updated and disabled', async () => {
  const res = await auth(request(app).post(base()))
    .send({ id: globalThis.__cmdId, name: 'start', description: 'Updated help text', enabled: false })
    .expect(201);
  assert.equal(res.body.command.description, 'Updated help text');
  assert.equal(res.body.command.enabled, false);

  const list = await auth(request(app).get(base())).expect(200);
  assert.equal(list.body.commands.length, 1);
});

test('sync requires explicit confirmation and pushes the enabled menu', async () => {
  await auth(request(app).post(`${base()}/sync`)).send({}).expect(400);

  const res = await auth(request(app).post(`${base()}/sync`)).send({ confirm: true }).expect(200);
  assert.equal(res.body.commands.length, 0, 'disabled commands are not published');
  assert.equal(mock.callsFor('setMyCommands').length, 1);
  assert.equal(res.body.sync.state, 'in_sync');

  // Re-enable and sync again.
  await auth(request(app).post(base())).send({ id: globalThis.__cmdId, name: 'start', description: 'Help', enabled: true }).expect(201);
  const res2 = await auth(request(app).post(`${base()}/sync`)).send({ confirm: true }).expect(200);
  assert.equal(res2.body.commands.length, 1);
  assert.deepEqual(res2.body.commands[0], { command: 'start', description: 'Help' });
  assert.equal(mock.state.commands.length, 1);
});

test('importing remote commands adds only missing entries', async () => {
  mock.state.commands = [
    { command: 'start', description: 'Help' },
    { command: 'settings', description: 'Bot settings' },
  ];
  const res = await auth(request(app).post(`${base()}/import`)).expect(200);
  assert.deepEqual(res.body.imported, ['/settings']);
  const names = res.body.commands.map((c) => c.name).sort();
  assert.deepEqual(names, ['settings', 'start']);
});

test('bulk replace validates duplicates and succeeds for valid input', async () => {
  const dup = await auth(request(app).put(base()))
    .send({ commands: [{ name: 'a' }, { name: 'a' }] })
    .expect(422);
  assert.ok(dup.body.error.details.some((d) => /Duplicate/.test(d.message)));

  const ok = await auth(request(app).put(base()))
    .send({ commands: [{ name: 'start', description: 'Welcome' }, { name: 'help', description: 'Help' }] })
    .expect(200);
  assert.equal(ok.body.commands.length, 2);
});

test('deleting a command removes it from the list', async () => {
  const list = await auth(request(app).get(base())).expect(200);
  const help = list.body.commands.find((c) => c.name === 'help');
  const res = await auth(request(app).delete(`${base()}/${help.id}`)).expect(200);
  assert.equal(res.body.commands.length, 1);
  await auth(request(app).delete(`${base()}/does-not-exist`)).expect(404);
});

test('another user cannot read or write these commands', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'command-intruder@example.com', password: 'another-long-password' })
    .expect(201);
  await request(app)
    .get(`/api/v1/bots/${botId}/commands`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(404);
  await request(app)
    .post(`/api/v1/bots/${botId}/commands`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ name: 'evil' })
    .expect(404);
});

test('sync surfaces Telegram rate limits safely', async () => {
  mock.state.failNext = { method: 'setMyCommands', status: 429, description: 'Too Many Requests', retryAfter: 3 };
  const res = await auth(request(app).post(`${base()}/sync`)).send({ confirm: true }).expect(429);
  assert.equal(res.body.error.code, 'rate_limited');
  assert.equal(res.body.error.details.retryAfter, 3);
});

test('a revoked bot cannot sync commands', async () => {
  await auth(request(app).post(`/api/v1/bots/${botId}/revoke`)).send({ confirm: true }).expect(200);
  const res = await auth(request(app).post(`${base()}/sync`)).send({ confirm: true }).expect(409);
  assert.equal(res.body.error.code, 'missing_token');
});
