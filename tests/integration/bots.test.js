import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';
import { botSecretRepo } from '../../backend/src/repositories/index.js';

let app;
let token;
let mock;
const OTHER_TOKEN = '9999999:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

test.before(async () => {
  await freshStores();
  app = await makeApp();
  mock = createMockTelegram();
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'botowner@example.com', password: 'long-enough-password' })
    .expect(201);
  token = res.body.token;
});

test.after(() => mock.restore());

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

test('connecting without ownership acknowledgement is rejected before any API call', async () => {
  const before = mock.calls.length;
  const res = await auth(request(app).post('/api/v1/bots/connect'))
    .send({ token: MOCK_TOKEN })
    .expect(400);
  assert.match(res.body.error.message, /confirm/i);
  assert.equal(mock.calls.length, before);
});

test('a malformed token is rejected without contacting Telegram', async () => {
  const before = mock.calls.length;
  const res = await auth(request(app).post('/api/v1/bots/connect'))
    .send({ token: 'not-a-token', acknowledgeOwnership: true })
    .expect(422);
  assert.equal(res.body.error.code, 'invalid_token_format');
  assert.equal(mock.calls.length, before);
});

test('Telegram rejects an invalid token and nothing is stored', async () => {
  mock.state.validTokens.delete(OTHER_TOKEN);
  const res = await auth(request(app).post('/api/v1/bots/connect'))
    .send({ token: OTHER_TOKEN, acknowledgeOwnership: true })
    .expect(422);
  assert.equal(res.body.error.code, 'invalid_token');
  const list = await auth(request(app).get('/api/v1/bots')).expect(200);
  assert.equal(list.body.bots.length, 0);
});

test('valid token connects the bot and returns safe metadata only', async () => {
  const res = await auth(request(app).post('/api/v1/bots/connect'))
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Store Bot', environment: 'production' })
    .expect(201);

  const bot = res.body.bot;
  assert.equal(bot.telegram.id, '7654321');
  assert.equal(bot.telegram.username, 'mock_bot');
  assert.equal(bot.connection.state, 'connected');
  assert.equal(bot.displayName, 'Store Bot');
  assert.equal(bot.environment, 'production');
  assert.ok(bot.tokenMask.includes('••'));
  assert.equal(JSON.stringify(res.body).includes('AAHdqTcv'), false, 'raw token must never be returned');

  const secret = await botSecretRepo.get(bot.id);
  assert.ok(secret.envelope.ct);
  assert.equal(JSON.stringify(secret).includes('AAHdqTcv'), false, 'token must be encrypted at rest');
  assert.equal(secret.envelope.alg, 'aes-256-gcm');
  assert.equal(secret.envelope.kid, '1');

  globalThis.__botId = bot.id;
});

test('duplicate connection returns a conflict pointing at the existing bot', async () => {
  const res = await auth(request(app).post('/api/v1/bots/connect'))
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true })
    .expect(409);
  assert.equal(res.body.error.code, 'conflict');
  assert.equal(res.body.error.details.existingBotId, globalThis.__botId);
});

test('bot list is scoped to the authenticated owner', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'intruder@example.com', password: 'another-long-password' })
    .expect(201);
  const res = await request(app)
    .get('/api/v1/bots')
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(200);
  assert.equal(res.body.bots.length, 0);

  await request(app)
    .get(`/api/v1/bots/${globalThis.__botId}`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(404);
  await request(app)
    .post(`/api/v1/bots/${globalThis.__botId}/validate`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(404);
  await request(app)
    .delete(`/api/v1/bots/${globalThis.__botId}`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ confirm: true })
    .expect(404);
});

test('diagnostics report token, webhook and workflow state', async () => {
  const res = await auth(request(app).get(`/api/v1/bots/${globalThis.__botId}/diagnostics`)).expect(200);
  const d = res.body.diagnostics;
  assert.equal(d.token.present, true);
  assert.equal(d.token.needsRotation, false);
  assert.equal(d.webhook.state, 'not_configured');
  assert.equal(d.worker.state, 'unknown');
  assert.equal(JSON.stringify(d).includes('AAHdqTcv'), false);
});

test('validation refreshes the connection state', async () => {
  const res = await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/validate`)).expect(200);
  assert.equal(res.body.bot.connection.state, 'connected');
  assert.equal(res.body.rotated, false);
});

test('an invalid token on revalidation degrades the connection state honestly', async () => {
  mock.state.validTokens.delete(MOCK_TOKEN);
  const res = await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/validate`)).expect(422);
  assert.equal(res.body.error.code, 'invalid_token');

  const detail = await auth(request(app).get(`/api/v1/bots/${globalThis.__botId}`)).expect(200);
  assert.equal(detail.body.bot.connection.state, 'invalid_token');
  assert.ok(detail.body.bot.connection.lastError.message);
  mock.state.validTokens.add(MOCK_TOKEN);
});

test('bot settings can be updated and are validated', async () => {
  const ok = await auth(request(app).patch(`/api/v1/bots/${globalThis.__botId}`))
    .send({ displayName: 'Renamed Bot', environment: 'development' })
    .expect(200);
  assert.equal(ok.body.bot.displayName, 'Renamed Bot');

  await auth(request(app).patch(`/api/v1/bots/${globalThis.__botId}`))
    .send({ environment: 'staging' })
    .expect(400);
  await auth(request(app).patch(`/api/v1/bots/${globalThis.__botId}`)).send({}).expect(400);
});

test('token replacement validates identity before storing', async () => {
  const res = await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/token`))
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true })
    .expect(200);
  assert.equal(res.body.bot.connection.state, 'connected');
  assert.equal(JSON.stringify(res.body).includes('AAHdqTcv'), false);

  await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/token`))
    .send({ token: 'not-a-token', acknowledgeOwnership: true })
    .expect(422);
});

test('suspend and delete operations demand explicit confirmation', async () => {
  await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/revoke`)).send({}).expect(400);

  const revoked = await auth(request(app).post(`/api/v1/bots/${globalThis.__botId}/revoke`))
    .send({ confirm: true })
    .expect(200);
  assert.equal(revoked.body.bot.connection.state, 'revoked');
  assert.equal(revoked.body.bot.tokenMask, null);
  assert.equal(await botSecretRepo.get(globalThis.__botId), null, 'revoke removes the encrypted token');

  await auth(request(app).delete(`/api/v1/bots/${globalThis.__botId}`)).send({}).expect(400);
  await auth(request(app).delete(`/api/v1/bots/${globalThis.__botId}`)).send({ confirm: true }).expect(204);
  await auth(request(app).get(`/api/v1/bots/${globalThis.__botId}`)).expect(404);
});

test('audit log records connection lifecycle without secrets', async () => {
  const { auditRepo } = await import('../../backend/src/repositories/index.js');
  const { userRepo } = await import('../../backend/src/repositories/index.js');
  const user = await userRepo.findCredentialsByEmail('botowner@example.com');
  const rows = await auditRepo.list(user.uid, { limit: 50 });
  const actions = rows.map((r) => r.action);
  assert.ok(actions.includes('bot.connected'));
  assert.ok(actions.includes('bot.revoked'));
  assert.ok(actions.includes('bot.deleted'));
  assert.equal(JSON.stringify(rows).includes('AAHdqTcv'), false);
});
