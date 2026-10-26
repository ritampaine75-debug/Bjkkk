/**
 * Phase 7 coverage: schedules, user restrictions and analytics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';

let app;
let token;
let uid;
let botId;
let mock;
let processUpdate;
let jobRepo;
let runDueJobs;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

function update(text, { id = Math.floor(Math.random() * 1e9), userId = 4242, command = null } = {}) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 4242, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'Tester', username: 'tester' },
      text: command ? `/${command}` : text,
    },
  };
}

test.before(async () => {
  await freshStores();
  mock = createMockTelegram();
  app = await makeApp();
  ({ processUpdate } = await import('../../backend/src/services/live-runtime.js'));
  ({ runDueJobs } = await import('../../backend/src/services/scheduler.js'));
  ({ jobRepo } = await import('../../backend/src/repositories/index.js'));

  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'advanced@example.com', password: 'a-long-password-1' })
    .expect(201);
  token = reg.body.token;
  uid = reg.body.user.uid;
  const connect = await auth(request(app).post('/api/v1/bots/connect')).send({
    token: MOCK_TOKEN,
    acknowledgeOwnership: true,
    displayName: 'Advanced Bot',
  }).expect(201);
  botId = connect.body.bot.id;
});

test.after(() => mock.restore());

const SCHEDULE_GRAPH = {
  schemaVersion: 1,
  name: 'Hourly digest',
  triggers: [{ id: 'trg_sched', type: 'schedule', config: { intervalMinutes: 60, timezone: 'UTC' } }],
  nodes: [{ id: 'nd_log', type: 'logEvent', config: { message: 'digest sent' }, position: { x: 0, y: 0 } }],
  edges: [{ id: 'e1', from: 'trg_sched', to: 'nd_log' }],
};

async function createAndPublish(graph) {
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`)).send({ template: 'blank' }).expect(201);
  const id = created.body.workflow.id;
  await auth(request(app).put(`/api/v1/bots/${botId}/workflows/${id}`)).send({ workflow: graph }).expect(200);
  const published = await auth(request(app).post(`/api/v1/bots/${botId}/workflows/${id}/publish`)).send({}).expect(200);
  return { id, published: published.body };
}

test('publishing a schedule workflow creates a job with a next-run time', async () => {
  const { id } = await createAndPublish(SCHEDULE_GRAPH);
  const res = await auth(request(app).get(`/api/v1/bots/${botId}/schedules`)).expect(200);
  const row = res.body.schedules.find((schedule) => schedule.workflowId === id);
  assert.ok(row, 'the schedule is listed');
  assert.equal(row.intervalMinutes, 60);
  assert.equal(row.active, true);
  assert.ok(row.nextRunAt, 'a next run time is computed');
  assert.ok(new Date(row.nextRunAt).getTime() > Date.now(), 'next run is in the future');
  assert.equal(res.body.scheduler.enabled, false, 'the scheduler loop is off by default');
});

test('pausing the workflow removes it from the active schedule set', async () => {
  const { id } = await createAndPublish({ ...SCHEDULE_GRAPH, name: 'Paused schedule' });
  await auth(request(app).post(`/api/v1/bots/${botId}/workflows/${id}/pause`)).send({}).expect(200);
  const job = await jobRepo.get(`job_${botId}_${id}_${uid.slice(0, 6)}`);
  assert.equal(job, null, 'the job is deleted when the workflow is paused');
  const res = await auth(request(app).get(`/api/v1/bots/${botId}/schedules`)).expect(200);
  const row = res.body.schedules.find((schedule) => schedule.workflowId === id);
  assert.equal(row.active, false);
});

test('a due job executes the published workflow and schedules the next run', async () => {
  const { id } = await createAndPublish({ ...SCHEDULE_GRAPH, name: 'Due schedule' });
  const jobId = `job_${botId}_${id}_${uid.slice(0, 6)}`;
  await jobRepo.update(jobId, { nextRunAt: new Date(Date.now() - 60_000).toISOString() });

  const results = await runDueJobs();
  const result = results.find((row) => row.workflowId === id);
  assert.ok(result, 'the due job ran');
  assert.equal(result.status, 'succeeded');

  const executions = await auth(request(app).get(`/api/v1/bots/${botId}/executions`)).expect(200);
  const scheduled = executions.body.executions.find((row) => row.workflowId === id);
  assert.ok(scheduled, 'the scheduled run is in the execution log');
  assert.equal(scheduled.triggerType, 'schedule');
  assert.equal(scheduled.mode, 'live');

  const refreshed = await jobRepo.get(jobId);
  assert.ok(new Date(refreshed.nextRunAt).getTime() > Date.now(), 'the next run moved into the future');
  assert.equal(refreshed.lastStatus, 'succeeded');
  assert.equal(refreshed.runs, 1);
});

test('a workflow can be run manually from the schedules screen', async () => {
  const { id } = await createAndPublish({ ...SCHEDULE_GRAPH, name: 'Manual schedule' });
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/schedules/${id}/run`)).send({}).expect(200);
  assert.equal(res.body.result.status, 'succeeded');
  assert.ok(res.body.schedules.some((schedule) => schedule.workflowId === id));
});

test('a draft workflow cannot be run on a schedule', async () => {
  const created = await auth(request(app).post(`/api/v1/bots/${botId}/workflows`)).send({ template: 'welcome' }).expect(201);
  const res = await auth(request(app).post(`/api/v1/bots/${botId}/schedules/${created.body.workflow.id}/run`)).send({});
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Publish/);
});

test('bot restrictions block users who are not on the allowlist', async () => {
  const patched = await auth(request(app).patch(`/api/v1/bots/${botId}/restrictions`))
    .send({ mode: 'allowlist', userIds: ['111'] })
    .expect(200);
  assert.equal(patched.body.bot.restrictions.mode, 'allowlist');
  assert.deepEqual(patched.body.bot.restrictions.userIds, ['111']);

  const blocked = await processUpdate({ uid, botId, update: update('hello', { userId: 4242 }) });
  assert.equal(blocked.skipped, 'user_not_allowed');

  const allowed = await processUpdate({ uid, botId, update: update('/start', { userId: 111 }) });
  assert.notEqual(allowed.skipped, 'user_not_allowed');
});

test('invalid restriction payloads are rejected', async () => {
  const badMode = await auth(request(app).patch(`/api/v1/bots/${botId}/restrictions`)).send({ mode: 'nobody' });
  assert.equal(badMode.status, 400);
  const badIds = await auth(request(app).patch(`/api/v1/bots/${botId}/restrictions`)).send({ mode: 'allowlist', userIds: ['abc'] });
  assert.equal(badIds.status, 400);
  const empty = await auth(request(app).patch(`/api/v1/bots/${botId}/restrictions`)).send({ mode: 'allowlist', userIds: [] });
  assert.equal(empty.status, 400);
  await auth(request(app).patch(`/api/v1/bots/${botId}/restrictions`)).send({ mode: 'everyone', userIds: [] }).expect(200);
});

test('command-level restrictions block specific users only', async () => {
  await auth(request(app).post(`/api/v1/bots/${botId}/commands`)).send({
    name: 'secret',
    description: 'Restricted command',
    reply: { text: 'classified' },
    access: { restrictedToUserIds: ['999'], blockedUserIds: [] },
  }).expect(201);

  const before = mock.calls.filter((call) => call.method === 'sendMessage').length;
  const blocked = await processUpdate({ uid, botId, update: update('', { userId: 4242, command: 'secret' }) });
  assert.equal(blocked.executions.length, 0, 'nothing was executed for the blocked user');
  assert.equal(mock.calls.filter((call) => call.method === 'sendMessage').length, before);

  const allowed = await processUpdate({ uid, botId, update: update('', { userId: 999, command: 'secret' }) });
  assert.equal(allowed.executions.length, 1);
  assert.equal(mock.calls.filter((call) => call.method === 'sendMessage').length, before + 1);
});

test('analytics summarise real executions with percentiles and daily buckets', async () => {
  const res = await auth(request(app).get(`/api/v1/bots/${botId}/analytics?days=7`)).expect(200);
  const analytics = res.body.analytics;
  assert.equal(analytics.window.days, 7);
  assert.ok(analytics.totals.runs >= 3, 'runs were counted');
  assert.ok(analytics.totals.succeeded >= 2);
  assert.ok(analytics.totals.successRate !== null);
  assert.ok(analytics.duration.p50Ms !== null);
  assert.equal(analytics.daily.length, 7);
  assert.ok(analytics.workflows.some((row) => row.workflowName === 'Due schedule'));
  assert.ok(Array.isArray(analytics.errors));
});

test('analytics for a bot without executions are explicitly empty, not fabricated', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'empty-analytics@example.com', password: 'a-long-password-1' })
    .expect(201);
  const second = await request(app)
    .post('/api/v1/bots/connect')
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Empty Bot' })
    .expect(201);
  const res = await request(app)
    .get(`/api/v1/bots/${second.body.bot.id}/analytics`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(200);
  assert.equal(res.body.analytics.totals.runs, 0);
  assert.equal(res.body.analytics.totals.successRate, null);
  assert.equal(res.body.analytics.duration.averageMs, null);
});
