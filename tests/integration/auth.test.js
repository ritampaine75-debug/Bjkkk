import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';

let app;

test.before(async () => {
  await freshStores();
  app = await makeApp();
});

test('health endpoint reports runtime state without secrets', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.auth, 'local');
  assert.equal(JSON.stringify(res.body).includes('TOKEN_ENCRYPTION'), false);
});

test('auth config exposes local mode for development', async () => {
  const res = await request(app).get('/api/v1/auth/config').expect(200);
  assert.equal(res.body.mode, 'local');
  assert.equal(res.body.firebase, null);
});

test('registration creates a session and public profile', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'owner@example.com', password: 'correct-horse-battery', displayName: 'Owner' })
    .expect(201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, 'owner@example.com');
  assert.equal(res.body.user.displayName, 'Owner');
  assert.equal('passwordHash' in res.body.user, false);
  assert.equal(JSON.stringify(res.body).includes('correct-horse-battery'), false);
});

test('duplicate registration is rejected', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'owner@example.com', password: 'correct-horse-battery' })
    .expect(409);
  assert.equal(res.body.error.code, 'conflict');
});

test('login rejects wrong passwords with a generic message', async () => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'owner@example.com', password: 'wrong-password' })
    .expect(401);
  assert.equal(res.body.error.message, 'Incorrect email or password.');
});

test('authenticated dashboard summary is empty but honest for new accounts', async () => {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'owner@example.com', password: 'correct-horse-battery' })
    .expect(200);
  const token = login.body.token;

  const summary = await request(app)
    .get('/api/v1/dashboard/summary')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.equal(summary.body.totals.bots, 0);
  assert.equal(summary.body.totals.executions, 0);
  assert.equal(summary.body.recentExecutions.length, 0);
  assert.equal(summary.body.gettingStarted.length, 5);
  assert.equal(summary.body.gettingStarted.every((s) => s.done === false), true);
});

test('management routes require a bearer token', async () => {
  await request(app).get('/api/v1/dashboard/summary').expect(401);
  await request(app).get('/api/v1/dashboard/summary').set('Authorization', 'Bearer nope').expect(401);
});

test('invalid JSON bodies are rejected safely', async () => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email": ')
    .expect(400);
  assert.equal(res.body.error.code, 'invalid_json');
});

test('unknown API routes return a JSON 404', async () => {
  const res = await request(app).get('/api/v1/nope').expect(404);
  assert.equal(res.body.error.code, 'not_found');
});

test('stored credentials never contain the plaintext password', async () => {
  const { getStore } = await import('../../backend/src/db/index.js');
  const store = await getStore();
  const rows = await store.query('credentials');
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes('correct-horse-battery'), false);
  assert.ok(rows[0].passwordHash.length > 32);
});

test('cross-user isolation: a second account sees its own empty dashboard', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'other@example.com', password: 'another-long-password' })
    .expect(201);
  const summary = await request(app)
    .get('/api/v1/dashboard/summary')
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(200);
  assert.equal(summary.body.totals.bots, 0);
  const { getStore } = await import('../../backend/src/db/index.js');
  const store = await getStore();
  const firstUid = (await store.query('credentials', { where: [{ field: 'email', op: '==', value: 'owner@example.com' }] }))[0].uid;
  assert.notEqual(firstUid, other.body.user.uid);
});
