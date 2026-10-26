import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvaluationContext, interpolate, evaluateCondition, truthy } from '../../backend/src/services/expression.js';

const event = {
  text: 'Hello there',
  command: 'start',
  callbackData: 'help',
  chat: { id: 42 },
  user: { id: 7, username: 'alex', first_name: 'Alex' },
  message_id: 99,
};

test('context exposes event fields and variables', () => {
  const context = buildEvaluationContext({ event, variables: { plan: 'pro' } });
  assert.equal(context.text, 'Hello there');
  assert.equal(context.userId, '7');
  assert.equal(context.chatId, '42');
  assert.equal(context.firstName, 'Alex');
  assert.equal(context.variables.plan, 'pro');
});

test('interpolation replaces known placeholders and blanks unknown ones', () => {
  const context = buildEvaluationContext({ event, variables: { plan: 'pro' } });
  assert.equal(interpolate('Hi {{user.first_name}} ({{username}})', context), 'Hi Alex (alex)');
  assert.equal(interpolate('Plan: {{variables.plan}}', context), 'Plan: pro');
  assert.equal(interpolate('Missing: {{nope}}!', context), 'Missing: !');
  assert.equal(interpolate('No placeholders', context), 'No placeholders');
  assert.equal(interpolate(undefined, context), '');
});

test('contains / equals / regex / numeric operators', () => {
  const context = buildEvaluationContext({ event });
  assert.equal(evaluateCondition({ subject: 'text', operator: 'contains', value: 'Hello' }, context), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'contains', value: 'zzz' }, context), false);
  assert.equal(evaluateCondition({ subject: 'command', operator: 'equals', value: 'start' }, context), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'regex', value: '^hello' }, context), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'regex', value: '([unclosed' }, context), false);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'startsWith', value: 'Hell' }, context), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'endsWith', value: 'there' }, context), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'notEquals', value: 'nope' }, context), true);

  const numericContext = buildEvaluationContext({ event: { text: '15' } });
  assert.equal(evaluateCondition({ subject: 'text', operator: 'gt', value: '10' }, numericContext), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'lt', value: '10' }, numericContext), false);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'gte', value: '15' }, numericContext), true);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'gt', value: 'abc' }, numericContext), false);
});

test('variable, user id and empty checks', () => {
  const context = buildEvaluationContext({ event, variables: { color: 'green', empty: '' } });
  assert.equal(evaluateCondition({ subject: 'variable', variableName: 'color', operator: 'equals', value: 'green' }, context), true);
  assert.equal(evaluateCondition({ subject: 'variable', variableName: 'missing', operator: 'isEmpty' }, context), true);
  assert.equal(evaluateCondition({ subject: 'variable', variableName: 'color', operator: 'isNotEmpty' }, context), true);
  assert.equal(evaluateCondition({ subject: 'userId', operator: 'equals', value: '7' }, context), true);
  assert.equal(evaluateCondition({ subject: 'callbackData', operator: 'equals', value: 'help' }, context), true);
  assert.equal(evaluateCondition({ subject: 'unknownSubject', operator: 'equals', value: 'x' }, context), false);
  assert.equal(evaluateCondition({ subject: 'text', operator: 'unknownOperator', value: 'x' }, context), false);
});

test('boolean subject parses friendly truthy values', () => {
  assert.equal(truthy('true'), true);
  assert.equal(truthy('YES'), true);
  assert.equal(truthy('0'), false);
  assert.equal(truthy(undefined), false);
});
