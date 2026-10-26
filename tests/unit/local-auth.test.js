import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/test-env.js';

const { validateSignupInput } = await import('../../backend/src/services/local-auth.js');

test('signup validation accepts a valid payload', () => {
  assert.doesNotThrow(() => validateSignupInput({ email: 'user@example.com', password: 'longenough1' }));
});

test('signup validation rejects bad email and short passwords', () => {
  try {
    validateSignupInput({ email: 'not-an-email', password: 'short' });
    assert.fail('expected validation error');
  } catch (err) {
    assert.equal(err.status, 422);
    const fields = err.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['email', 'password']);
  }
});
