import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { freshStores, makeApp } from '../helpers/test-env.js';
import { createMockTelegram, MOCK_TOKEN } from '../helpers/mock-telegram.js';
import { createWelcomeTemplate, validateWorkflow } from '../../shared/workflow-schema.js';

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
    .send({ email: 'workflows@example.com', password: 'a-long-password-1', displayName: 'WF' })
    .expect(201);
  token = reg.body.token;
  const connect = await request(app)
    .post('/api/v1/bots/connect')
    .set('Authorization', `Bearer ${token}`)
    .send({ token: MOCK_TOKEN, acknowledgeOwnership: true, displayName: 'Workflow Bot' })
    .expect(201);
  botId = connect.body.bot.id;
});

test.after(() => mock.restore());
const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const base = () => `/api/v1/bots/${botId}/workflows`;

test('catalog describes triggers, nodes and limits', async () => {
  const res = await auth(request(app).get(`${base()}/catalog`)).expect(200);
  assert.ok(res.body.triggers.some((t) => t.type === 'command'));
  assert.ok(res.body.nodes.some((n) => n.type === 'condition' && n.outputs === 2));
  assert.equal(res.body.limits.MAX_NODES, 60);
  assert.equal(typeof res.body.httpActionsEnabled, 'boolean');
});

test('creating a blank workflow starts as an empty draft', async () => {
  const res = await auth(request(app).post(base())).send({ template: 'blank', name: 'My First Flow' }).expect(201);
  const wf = res.body.workflow;
  assert.equal(wf.name, 'My First Flow');
  assert.equal(wf.status, 'draft');
  assert.equal(wf.triggers.length, 0);
  assert.equal(wf.nodes.length, 0);
  globalThis.__blankId = wf.id;
});

test('the welcome template creates a /start workflow', async () => {
  const res = await auth(request(app).post(base())).send({ template: 'welcome' }).expect(201);
  workflowId = res.body.workflow.id;
  const wf = res.body.workflow;
  assert.equal(wf.triggers[0].config.command, 'start');
  assert.equal(wf.nodes.length, 2);
  assert.equal(wf.summary.triggerSummary, '/start');
});

test('saving an incomplete draft succeeds but reports validation errors', async () => {
  const saved = await auth(request(app).put(`${base()}/${globalThis.__blankId}`))
    .send({ workflow: { name: 'My First Flow', triggers: [], nodes: [], edges: [] } })
    .expect(200);
  assert.equal(saved.body.valid, false);
  assert.ok(saved.body.errors.length >= 2);
});

test('a complete workflow saves with no errors and keeps its graph', async () => {
  const graph = createWelcomeTemplate();
  graph.name = 'Welcome workflow';
  const res = await auth(request(app).put(`${base()}/${workflowId}`)).send({ workflow: graph }).expect(200);
  assert.equal(res.body.valid, true, JSON.stringify(res.body.errors));
  assert.equal(res.body.workflow.nodes.length, 2);
  assert.equal(res.body.workflow.triggers[0].type, 'command');

  const fetched = await auth(request(app).get(`${base()}/${workflowId}`)).expect(200);
  assert.equal(fetched.body.workflow.draft.nodes.length, 2);
  assert.equal(fetched.body.workflow.status, 'draft');
});

test('validate endpoint reports field errors without saving', async () => {
  const res = await auth(request(app).post(`${base()}/${workflowId}/validate`))
    .send({ workflow: { name: 'Broken', triggers: [{ id: 't', type: 'bogus', config: {} }], nodes: [], edges: [] } })
    .expect(200);
  assert.equal(res.body.valid, false);
  assert.ok(res.body.errors.some((e) => /Unsupported trigger type/.test(e.message)));
});

test('publishing is blocked until the draft is valid', async () => {
  const res = await auth(request(app).post(`${base()}/${globalThis.__blankId}/publish`)).send({}).expect(422);
  assert.equal(res.body.error.code, 'validation_failed');
});

test('publishing creates an immutable version and marks the workflow published', async () => {
  const res = await auth(request(app).post(`${base()}/${workflowId}/publish`)).send({}).expect(200);
  assert.equal(res.body.version, 1);
  assert.equal(res.body.workflow.status, 'published');
  assert.equal(res.body.workflow.publishedVersion, 1);
  assert.equal(res.body.workflow.hasDraftChanges, false);

  const versions = await auth(request(app).get(`${base()}/${workflowId}/versions`)).expect(200);
  assert.equal(versions.body.versions.length, 1);
  assert.equal(versions.body.versions[0].version, 1);
});

test('editing after publish does not change the published snapshot', async () => {
  const graph = createWelcomeTemplate();
  graph.name = 'Welcome workflow v2';
  graph.nodes[0].config.text = 'Updated welcome text';
  const saved = await auth(request(app).put(`${base()}/${workflowId}`)).send({ workflow: graph }).expect(200);
  assert.equal(saved.body.workflow.hasDraftChanges, true);

  const fetched = await auth(request(app).get(`${base()}/${workflowId}`)).expect(200);
  assert.equal(fetched.body.workflow.published.nodes[0].config.text.includes('Welcome to BotForge Demo Bot'), true);
  assert.equal(fetched.body.workflow.draft.nodes[0].config.text, 'Updated welcome text');
});

test('production bots require explicit publish confirmation', async () => {
  await auth(request(app).patch(`/api/v1/bots/${botId}`)).send({ environment: 'production' }).expect(200);
  const res = await auth(request(app).post(`${base()}/${workflowId}/publish`)).send({}).expect(409);
  assert.equal(res.body.error.code, 'production_confirmation_required');
  const ok = await auth(request(app).post(`${base()}/${workflowId}/publish`)).send({ confirmProduction: true }).expect(200);
  assert.equal(ok.body.version, 2);
  await auth(request(app).patch(`/api/v1/bots/${botId}`)).send({ environment: 'development' }).expect(200);
});

test('pause and resume manage live execution state', async () => {
  const paused = await auth(request(app).post(`${base()}/${workflowId}/pause`)).expect(200);
  assert.equal(paused.body.workflow.status, 'paused');
  await auth(request(app).post(`${base()}/${workflowId}/pause`)).expect(400);
  const resumed = await auth(request(app).post(`${base()}/${workflowId}/resume`)).expect(200);
  assert.equal(resumed.body.workflow.status, 'published');
});

test('version history can be inspected and restored into the draft', async () => {
  const versions = await auth(request(app).get(`${base()}/${workflowId}/versions`)).expect(200);
  const first = versions.body.versions.at(-1);
  const detail = await auth(request(app).get(`${base()}/${workflowId}/versions/${first.id}`)).expect(200);
  assert.ok(detail.body.version.workflow.nodes.length >= 1);

  const restored = await auth(request(app).post(`${base()}/${workflowId}/versions/${first.id}/restore`)).expect(200);
  assert.equal(restored.body.workflow.draft.nodes[0].config.text.includes('Welcome to BotForge Demo Bot'), true);
  assert.equal(restored.body.workflow.version, 2, 'restoring a draft does not rewrite published history');
});

test('duplicate, export and import round trip', async () => {
  const dup = await auth(request(app).post(`${base()}/${workflowId}/duplicate`)).expect(201);
  assert.match(dup.body.workflow.name, /\(copy\)$/);
  assert.equal(dup.body.workflow.status, 'draft');

  const exported = await auth(request(app).get(`${base()}/${workflowId}/export`)).expect(200);
  assert.equal(exported.body.botforgeExport, true);
  assert.ok(exported.body.workflow.triggers.length >= 1);

  const imported = await auth(request(app).post(`${base()}/import`)).send({ document: exported.body }).expect(201);
  assert.equal(imported.body.workflow.status, 'draft');
  assert.equal(imported.body.workflow.triggers[0].config.command, 'start');

  const invalid = await auth(request(app).post(`${base()}/import`))
    .send({ document: { name: 'Bad', triggers: [{ id: 't', type: 'nope', config: {} }], nodes: [], edges: [] } })
    .expect(422);
  assert.equal(invalid.body.error.code, 'validation_failed');
});

test('published workflows cannot be deleted without pausing first', async () => {
  const res = await auth(request(app).delete(`${base()}/${workflowId}`)).expect(409);
  assert.match(res.body.error.message, /Pause/);
  await auth(request(app).post(`${base()}/${workflowId}/pause`)).expect(200);
  await auth(request(app).delete(`${base()}/${workflowId}`)).expect(204);
});

test('another account cannot access these workflows', async () => {
  const other = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: 'wf-intruder@example.com', password: 'another-long-password' })
    .expect(201);
  await request(app)
    .get(`/api/v1/bots/${botId}/workflows`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(404);
  await request(app)
    .put(`/api/v1/bots/${botId}/workflows/${workflowId}`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ workflow: createWelcomeTemplate() })
    .expect(404);
});

test('stored workflow documents always validate against the shared schema', async () => {
  const list = await auth(request(app).get(base())).expect(200);
  for (const summary of list.body.workflows) {
    const detail = await auth(request(app).get(`${base()}/${summary.id}`)).expect(200);
    const result = validateWorkflow(detail.body.workflow.draft);
    // Drafts may be incomplete, but they must never contain unknown node types.
    assert.equal(
      result.errors.some((e) => /Unsupported (node|trigger) type/.test(e.message)),
      false,
      `workflow ${summary.id} contains unsupported types`,
    );
  }
});
