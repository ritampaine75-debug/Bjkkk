import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow, assertSafeHttpUrl, WorkflowExecutionError } from '../../backend/src/services/workflow-engine.js';
import { createMockTransport } from '../../backend/src/services/transports/mock-transport.js';
import {
  createWelcomeTemplate,
  createTrigger,
  createNode,
  validateWorkflow,
} from '../../shared/workflow-schema.js';

const startEvent = {
  text: '/start',
  command: 'start',
  chat: { id: 1000 },
  user: { id: 55, username: 'tester', first_name: 'Test' },
};

test('executes the welcome template and records each step', async () => {
  const graph = createWelcomeTemplate();
  const transport = createMockTransport();
  const result = await executeWorkflow({
    graph,
    triggerId: graph.triggers[0].id,
    transport,
    event: startEvent,
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].type, 'sendKeyboard');
  assert.equal(result.steps[1].type, 'end');
  assert.equal(result.transcript.length, 1);
  assert.equal(result.transcript[0].direction, 'out');
  assert.match(result.transcript[0].text, /Welcome to BotForge Demo Bot/);
  assert.equal(result.transcript[0].keyboard.length, 2, 'inline keyboard rows are sent');
  assert.equal(result.mode, 'simulation');
});

test('interpolates user details into messages', async () => {
  const trigger = createTrigger('command', { command: 'start' });
  const node = createNode('sendMessage', { text: 'Hello {{user.first_name}}, your id is {{user.id}}.' }, { x: 0, y: 0 });
  const graph = {
    schemaVersion: 1,
    name: 'greeting',
    triggers: [trigger],
    nodes: [node],
    edges: [{ id: 'e1', from: trigger.id, to: node.id }],
  };
  const transport = createMockTransport();
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport, event: startEvent });
  assert.equal(result.status, 'succeeded');
  assert.equal(transport.messages[0].text, 'Hello Test, your id is 55.');
});

test('follows the true branch of a condition', async () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'contains', value: 'help' });
  const yes = createNode('sendMessage', { text: 'Here is help' });
  const no = createNode('sendMessage', { text: 'No idea' });
  const graph = {
    schemaVersion: 1,
    name: 'branch',
    triggers: [trigger],
    nodes: [condition, yes, no],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: yes.id, label: 'true' },
      { from: condition.id, to: no.id, label: 'false' },
    ],
  };
  const transport = createMockTransport();
  const result = await executeWorkflow({
    graph,
    triggerId: trigger.id,
    transport,
    event: { text: 'I need help', chat: { id: 1 }, user: { id: 2 } },
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(transport.messages.length, 1);
  assert.equal(transport.messages[0].text, 'Here is help');
  const conditionStep = result.steps.find((step) => step.type === 'condition');
  assert.equal(conditionStep.output.label, 'true');
});

test('follows the false branch and records it', async () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'equals', value: 'yes' });
  const yes = createNode('sendMessage', { text: 'affirmative' });
  const no = createNode('sendMessage', { text: 'negative' });
  const graph = {
    schemaVersion: 1,
    name: 'branch',
    triggers: [trigger],
    nodes: [condition, yes, no],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: yes.id, label: 'true' },
      { from: condition.id, to: no.id, label: 'false' },
    ],
  };
  const transport = createMockTransport();
  await executeWorkflow({ graph, triggerId: trigger.id, transport, event: { text: 'no', chat: { id: 1 }, user: { id: 2 } } });
  assert.equal(transport.messages[0].text, 'negative');
});

test('variables are set, interpolated and usable in conditions', async () => {
  const trigger = createTrigger('text');
  const setVar = createNode('setVariable', { name: 'plan', value: 'pro' });
  const condition = createNode('condition', { subject: 'variable', variableName: 'plan', operator: 'equals', value: 'pro' });
  const yes = createNode('sendMessage', { text: 'You are on the {{variables.plan}} plan.' });
  const no = createNode('sendMessage', { text: 'Free plan' });
  const graph = {
    schemaVersion: 1,
    name: 'vars',
    triggers: [trigger],
    nodes: [setVar, condition, yes, no],
    edges: [
      { from: trigger.id, to: setVar.id },
      { from: setVar.id, to: condition.id },
      { from: condition.id, to: yes.id, label: 'true' },
      { from: condition.id, to: no.id, label: 'false' },
    ],
  };
  const transport = createMockTransport();
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport, event: { text: 'hi', chat: { id: 1 }, user: { id: 2 } } });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.variables.plan, 'pro');
  assert.equal(transport.messages[0].text, 'You are on the pro plan.');
});

test('transport failures mark the execution failed with a safe error', async () => {
  const trigger = createTrigger('text');
  const node = createNode('sendMessage', { text: 'hello' });
  const graph = {
    schemaVersion: 1,
    name: 'fail',
    triggers: [trigger],
    nodes: [node],
    edges: [{ from: trigger.id, to: node.id }],
  };
  const transport = createMockTransport();
  transport.sendMessage = async () => {
    throw Object.assign(new Error('Forbidden: bot was blocked by the user'), { code: 'blocked' });
  };
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport, event: { text: 'x', chat: { id: 1 } } });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'blocked');
  assert.equal(result.steps.at(-1).status, 'failed');
});

test('a trigger with no steps fails safely', async () => {
  const trigger = createTrigger('text');
  const graph = { schemaVersion: 1, name: 'empty', triggers: [trigger], nodes: [], edges: [] };
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport: createMockTransport(), event: {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'no_steps');
});

test('step limits stop runaway workflows', async () => {
  const trigger = createTrigger('text');
  const node = createNode('logEvent', { message: 'tick' });
  const graph = {
    schemaVersion: 1,
    name: 'long',
    triggers: [trigger],
    nodes: [node],
    edges: [{ from: trigger.id, to: node.id }],
  };
  const result = await executeWorkflow({
    graph,
    triggerId: trigger.id,
    transport: createMockTransport(),
    event: {},
    maxSteps: 1,
    timeoutMs: 5000,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.steps.length, 1);
});

test('delays that exceed the deadline are refused instead of hanging', async () => {
  const trigger = createTrigger('text');
  const delay = createNode('delay', { ms: 2000 });
  const graph = {
    schemaVersion: 1,
    name: 'slow',
    triggers: [trigger],
    nodes: [delay],
    edges: [{ from: trigger.id, to: delay.id }],
  };
  const result = await executeWorkflow({
    graph,
    triggerId: trigger.id,
    transport: createMockTransport(),
    event: {},
    timeoutMs: 500,
  });
  assert.equal(result.status, 'timeout');
  assert.equal(result.error.code, 'timeout');
});

test('HTTP actions block private addresses, non-HTTPS and non-allowlisted hosts', () => {
  assert.throws(() => assertSafeHttpUrl('http://example.com'), (err) => err.code === 'insecure_url');
  assert.throws(() => assertSafeHttpUrl('https://169.254.169.254/latest/meta-data'), (err) => err.code === 'blocked_host');
  assert.throws(() => assertSafeHttpUrl('https://localhost:8443/x'), (err) => err.code === 'blocked_host');
  assert.throws(() => assertSafeHttpUrl('https://10.0.0.5/x'), (err) => err.code === 'blocked_host');
  assert.throws(() => assertSafeHttpUrl('https://example.com/hook', { allowedHosts: ['api.example.com'] }), (err) => err.code === 'host_not_allowed');
  assert.equal(assertSafeHttpUrl('https://api.example.com/hook', { allowedHosts: ['api.example.com'] }).hostname, 'api.example.com');
});

test('an HTTP action node without server support fails safely', async () => {
  const trigger = createTrigger('manual');
  const node = createNode('httpRequest', { url: 'https://169.254.169.254/latest/meta-data', method: 'GET' });
  const graph = {
    schemaVersion: 1,
    name: 'ssrf',
    triggers: [trigger],
    nodes: [node],
    edges: [{ from: trigger.id, to: node.id }],
  };
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport: createMockTransport(), event: {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'blocked_host');
});

test('unsupported node types are rejected at execution time', async () => {
  const trigger = createTrigger('text');
  const graph = {
    schemaVersion: 1,
    name: 'weird',
    triggers: [trigger],
    nodes: [{ id: 'n1', type: 'shellCommand', config: {} }],
    edges: [{ from: trigger.id, to: 'n1' }],
  };
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport: createMockTransport(), event: {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'unsupported_node');
});

test('converging branches execute a shared node once', async () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'equals', value: 'a' });
  const shared = createNode('logEvent', { message: 'shared' });
  const graph = {
    schemaVersion: 1,
    name: 'merge',
    triggers: [trigger],
    nodes: [condition, shared],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: shared.id, label: 'true' },
      { from: condition.id, to: shared.id, label: 'false' },
    ],
  };
  const result = await executeWorkflow({ graph, triggerId: trigger.id, transport: createMockTransport(), event: { text: 'b' } });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.steps.filter((step) => step.type === 'logEvent').length, 1);
});

test('a valid template stays valid after schema validation', () => {
  const template = createWelcomeTemplate();
  assert.equal(validateWorkflow(template).valid, true);
});
