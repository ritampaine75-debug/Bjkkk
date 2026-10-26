import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWelcomeTemplate,
  createTrigger,
  createNode,
  validateWorkflow,
} from '../../shared/workflow-schema.js';
import {
  buildFormModel,
  applyFormModel,
  canEditInForm,
  createFormStep,
} from '../../shared/workflow-form-model.js';

test('the welcome template projects into form steps and back', () => {
  const graph = createWelcomeTemplate();
  const check = canEditInForm(graph);
  assert.equal(check.editable, true, check.reasons.join('; '));

  const model = buildFormModel(graph);
  assert.equal(model.trigger.type, 'command');
  assert.equal(model.trigger.config.command, 'start');
  assert.deepEqual(model.steps.map((s) => s.type), ['sendKeyboard', 'end']);

  const rebuilt = applyFormModel(model, graph);
  const result = validateWorkflow(rebuilt);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(rebuilt.nodes.map((n) => n.id), graph.nodes.map((n) => n.id), 'ids are preserved');
  assert.equal(rebuilt.nodes[0].config.text, graph.nodes[0].config.text);
  assert.equal(rebuilt.nodes[0].config.keyboard.rows.length, 2);
});

test('conditions project with both branches and survive the round trip', () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'contains', value: 'help' });
  const yes = createNode('sendMessage', { text: 'Here is help' });
  const no = createNode('sendMessage', { text: 'Unknown command' });
  const graph = {
    schemaVersion: 1,
    name: 'Branching',
    triggers: [trigger],
    nodes: [condition, yes, no],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: yes.id, label: 'true' },
      { from: condition.id, to: no.id, label: 'false' },
    ],
  };
  assert.equal(canEditInForm(graph).editable, true);
  const model = buildFormModel(graph);
  assert.equal(model.steps.length, 1);
  assert.equal(model.steps[0].type, 'condition');
  assert.equal(model.steps[0].branches.true[0].config.text, 'Here is help');
  assert.equal(model.steps[0].branches.false[0].config.text, 'Unknown command');

  const rebuilt = applyFormModel(model, graph);
  const result = validateWorkflow(rebuilt);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const labels = rebuilt.edges.filter((e) => e.from === condition.id).map((e) => e.label).sort();
  assert.deepEqual(labels, ['false', 'true']);
});

test('multiple triggers make the workflow advanced-only', () => {
  const graph = createWelcomeTemplate();
  graph.triggers.push(createTrigger('keyword', { keywords: ['hi'] }));
  const check = canEditInForm(graph);
  assert.equal(check.editable, false);
  assert.match(check.reasons.join(' '), /2 triggers/);
});

test('merging branches make the workflow advanced-only', () => {
  const trigger = createTrigger('text');
  const condition = createNode('condition', { subject: 'text', operator: 'equals', value: 'a' });
  const merged = createNode('sendMessage', { text: 'done' });
  const graph = {
    name: 'merge',
    triggers: [trigger],
    nodes: [condition, merged],
    edges: [
      { from: trigger.id, to: condition.id },
      { from: condition.id, to: merged.id, label: 'true' },
      { from: condition.id, to: merged.id, label: 'false' },
    ],
  };
  const check = canEditInForm(graph);
  assert.equal(check.editable, false);
  assert.match(check.reasons.join(' '), /merge/);
});

test('orphan nodes are reported instead of being dropped', () => {
  const trigger = createTrigger('text');
  const node = createNode('sendMessage', { text: 'a' });
  const orphan = createNode('sendMessage', { text: 'b' });
  const graph = { name: 'x', triggers: [trigger], nodes: [node, orphan], edges: [{ from: trigger.id, to: node.id }] };
  const check = canEditInForm(graph);
  assert.equal(check.editable, false);
  assert.match(check.reasons.join(' '), /not connected/);
});

test('a new condition step starts with empty branches', () => {
  const step = createFormStep('condition');
  assert.deepEqual(step.branches, { true: [], false: [] });
  const model = { trigger: { id: 't', type: 'text', config: {} }, steps: [step] };
  const graph = applyFormModel(model, { name: 'n' });
  const result = validateWorkflow(graph);
  // The condition has no outgoing branches yet, so validation reports them.
  assert.ok(result.errors.some((e) => /needs a "(true|false)" branch connection/.test(e.message)));
});
