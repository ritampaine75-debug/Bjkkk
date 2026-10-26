import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkflow,
  createWelcomeTemplate,
  validateWorkflow,
  hasCycle,
  executionOrder,
  summarizeWorkflow,
  createTrigger,
  createNode,
  workflowFingerprint,
} from '../../shared/workflow-schema.js';

test('welcome template is valid and executable', () => {
  const template = createWelcomeTemplate();
  const result = validateWorkflow(template);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.length, 0);
  assert.equal(result.workflow.triggers[0].config.command, 'start');
  assert.equal(result.workflow.nodes.length, 2);
});

test('an empty workflow reports the missing trigger and node', () => {
  const result = validateWorkflow(createEmptyWorkflow());
  const fields = result.errors.map((e) => e.field);
  assert.ok(fields.includes('name') === false, 'default name is valid');
  assert.ok(fields.includes('triggers'));
  assert.ok(fields.includes('nodes'));
});

test('duplicate command triggers are rejected', () => {
  const triggerA = createTrigger('command', { command: 'start' });
  const triggerB = createTrigger('command', { command: 'start' });
  const node = createNode('sendMessage', { text: 'hi' });
  const result = validateWorkflow({
    name: 'dup',
    triggers: [triggerA, triggerB],
    nodes: [node],
    edges: [
      { from: triggerA.id, to: node.id },
      { from: triggerB.id, to: node.id },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /More than one trigger uses \/start/.test(e.message)));
});

test('invalid node configuration is reported per field', () => {
  const trigger = createTrigger('text');
  const empty = createNode('sendMessage', { text: '' });
  const badVar = createNode('setVariable', { name: '1bad', value: 'x' });
  const badDelay = createNode('delay', { ms: 10 * 60 * 1000 });
  const result = validateWorkflow({
    name: 'bad nodes',
    triggers: [trigger],
    nodes: [empty, badVar, badDelay],
    edges: [
      { from: trigger.id, to: empty.id },
      { from: empty.id, to: badVar.id },
      { from: badVar.id, to: badDelay.id },
    ],
  });
  const fields = result.errors.map((e) => e.field);
  assert.ok(fields.some((f) => f.startsWith('nodes[0].config.text')));
  assert.ok(fields.some((f) => f.startsWith('nodes[1].config.name')));
  assert.ok(fields.some((f) => f.startsWith('nodes[2].config.ms')));
});

test('conditions require labelled true/false branches', () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'contains', value: 'hi' });
  const yes = createNode('sendMessage', { text: 'yes' });
  const no = createNode('sendMessage', { text: 'no' });
  const missingLabel = validateWorkflow({
    name: 'cond',
    triggers: [trigger],
    nodes: [condition, yes, no],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: yes.id },
    ],
  });
  assert.ok(missingLabel.errors.some((e) => /labelled "true" or "false"/.test(e.message)));

  const ok = validateWorkflow({
    name: 'cond',
    triggers: [trigger],
    nodes: [condition, yes, no],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: yes.id, label: 'true' },
      { from: condition.id, to: no.id, label: 'false' },
    ],
  });
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
});

test('cycles are rejected and detected by hasCycle', () => {
  const trigger = createTrigger('text');
  const a = createNode('sendMessage', { text: 'a' });
  const b = createNode('sendMessage', { text: 'b' });
  const graph = {
    name: 'loop',
    triggers: [trigger],
    nodes: [a, b],
    edges: [
      { from: trigger.id, to: a.id },
      { from: a.id, to: b.id },
      { from: b.id, to: a.id },
    ],
  };
  assert.equal(hasCycle(graph), true);
  const result = validateWorkflow(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /contains a loop/.test(e.message)));
});

test('unreachable nodes produce a warning, not an error', () => {
  const trigger = createTrigger('text');
  const connected = createNode('sendMessage', { text: 'a' });
  const orphan = createNode('sendMessage', { text: 'b' });
  const result = validateWorkflow({
    name: 'orphan',
    triggers: [trigger],
    nodes: [connected, orphan],
    edges: [{ from: trigger.id, to: connected.id }],
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /not reachable/.test(w.message)));
});

test('unconnected triggers are an error', () => {
  const trigger = createTrigger('text');
  const node = createNode('sendMessage', { text: 'a' });
  const result = validateWorkflow({ name: 'x', triggers: [trigger], nodes: [node], edges: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /not connected/.test(e.message)));
});

test('limits are enforced', () => {
  const trigger = createTrigger('text');
  const nodes = Array.from({ length: 61 }, (_, i) => createNode('sendMessage', { text: `m${i}` }));
  const edges = nodes.map((node, i) => ({ from: i === 0 ? trigger.id : nodes[i - 1].id, to: node.id }));
  const result = validateWorkflow({ name: 'big', triggers: [trigger], nodes, edges });
  assert.ok(result.errors.some((e) => /at most 60 nodes/.test(e.message)));
});

test('unknown node types and missing edges targets are rejected', () => {
  const trigger = createTrigger('text');
  const result = validateWorkflow({
    name: 'unknown',
    triggers: [trigger],
    nodes: [{ id: 'n1', type: 'runJavaScript', config: {} }],
    edges: [{ from: trigger.id, to: 'n1' }, { from: 'n1', to: 'ghost' }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Unsupported node type/.test(e.message)));
  assert.ok(result.errors.some((e) => /Edge target must be an existing node/.test(e.message)));
});

test('HTTP action nodes are blocked unless explicitly enabled', () => {
  const trigger = createTrigger('manual');
  const node = createNode('httpRequest', { url: 'https://api.example.com/hook' });
  const disabled = validateWorkflow({ name: 'http', triggers: [trigger], nodes: [node], edges: [{ from: trigger.id, to: node.id }] });
  assert.ok(disabled.errors.some((e) => /disabled on this deployment/.test(e.message)));

  const enabled = validateWorkflow(
    { name: 'http', triggers: [trigger], nodes: [node], edges: [{ from: trigger.id, to: node.id }] },
    { allowHttp: true, allowedHosts: ['api.example.com'] },
  );
  assert.equal(enabled.valid, true, JSON.stringify(enabled.errors));

  const notAllowed = validateWorkflow(
    {
      name: 'http',
      triggers: [trigger],
      nodes: [createNode('httpRequest', { url: 'https://metadata.internal/latest' })],
      edges: [{ from: trigger.id, to: 'nope' }],
    },
    { allowHttp: true, allowedHosts: ['api.example.com'] },
  );
  assert.ok(notAllowed.errors.some((e) => /not in the allowlist/.test(e.message)));

  const insecure = validateWorkflow(
    { name: 'http', triggers: [trigger], nodes: [createNode('httpRequest', { url: 'http://example.com' })], edges: [] },
    { allowHttp: true, allowedHosts: [] },
  );
  assert.ok(insecure.errors.some((e) => /Only HTTPS URLs/.test(e.message)));
});

test('execution order walks the graph breadth-first from a trigger', () => {
  const template = createWelcomeTemplate();
  const order = executionOrder(template, template.triggers[0].id);
  assert.deepEqual(order.map((entry) => entry.node.type), ['sendKeyboard', 'end']);
});

test('summaries and fingerprints reflect graph changes', () => {
  const template = createWelcomeTemplate();
  const summary = summarizeWorkflow(template);
  assert.equal(summary.triggerSummary, '/start');
  assert.equal(summary.nodeCount, 2);

  const before = workflowFingerprint(template);
  template.nodes[0].config.text = 'Changed';
  assert.notEqual(workflowFingerprint(template), before);
});

test('invalid regex and numeric comparisons are reported', () => {
  const trigger = createTrigger('text');
  const badRegex = createNode('condition', { subject: 'text', operator: 'regex', value: '([a-z' });
  const badNumber = createNode('condition', { subject: 'text', operator: 'gt', value: 'abc' });
  const result = validateWorkflow({
    name: 'conditions',
    triggers: [trigger],
    nodes: [badRegex, badNumber],
    edges: [
      { from: trigger.id, to: badRegex.id },
      { from: badRegex.id, to: badNumber.id, label: 'false' },
    ],
  });
  const fields = result.errors.map((e) => e.field);
  assert.ok(fields.includes('nodes[0].config.value'));
  assert.ok(fields.includes('nodes[1].config.value'));
});

test('schema version mismatch is rejected', () => {
  const result = validateWorkflow({ schemaVersion: 99, name: 'x', triggers: [], nodes: [], edges: [] });
  assert.ok(result.errors.some((e) => /Unsupported schema version/.test(e.message)));
});

test('variable values are bounded and validated', () => {
  const result = validateWorkflow({
    name: 'vars',
    triggers: [],
    nodes: [],
    edges: [],
    variables: { ok: 'value', '1bad': 'x' },
  });
  assert.ok(result.errors.some((e) => e.field === 'variables.1bad'));
});
