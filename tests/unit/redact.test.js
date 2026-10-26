import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactString, maskToken, summarizeText } from '../../backend/src/utils/redact.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

test('maskToken keeps only a short prefix and suffix', () => {
  const masked = maskToken(TOKEN);
  assert.ok(!masked.includes('AAHdqTcv'));
  assert.ok(masked.startsWith('1234'));
  assert.ok(masked.endsWith('saw'));
  assert.equal(maskToken(''), '');
  assert.equal(maskToken('short'), '********');
});

test('redactString strips embedded bot tokens from free text', () => {
  const input = `Request failed for token ${TOKEN} while calling getMe`;
  const output = redactString(input);
  assert.ok(!output.includes('AAHdqTcv'));
  assert.ok(output.includes('[redacted]') === false); // tokens are masked, not labelled
  assert.ok(output.includes('1234'));
});

test('redact masks sensitive object keys recursively', () => {
  const result = redact({
    name: 'demo',
    token: TOKEN,
    nested: { authorization: 'Bearer abc', keep: 'value' },
    list: [{ apiKey: 'secret-key' }],
  });
  assert.equal(result.token, '[redacted]');
  assert.equal(result.nested.authorization, '[redacted]');
  assert.equal(result.nested.keep, 'value');
  assert.equal(result.list[0].apiKey, '[redacted]');
  assert.equal(result.name, 'demo');
});

test('redact handles circular structures', () => {
  const obj = { name: 'x' };
  obj.self = obj;
  const result = redact(obj);
  assert.equal(result.self, '[circular]');
});

test('summarizeText collapses whitespace and truncates', () => {
  assert.equal(summarizeText('a\n\n  b'), 'a b');
  assert.equal(summarizeText('x'.repeat(20), 5), 'xxxxx...');
  assert.equal(summarizeText(null), '');
});
