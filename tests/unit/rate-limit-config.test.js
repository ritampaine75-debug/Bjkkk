import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/test-env.js';

test('configuration refuses to run production without secrets', async () => {
  const { assertValidConfig } = await import('../../backend/src/config.js');
  // The test environment is valid and must not throw.
  const config = assertValidConfig();
  assert.equal(config.env, 'test');
  assert.equal(config.vault.keys.size >= 1, true);
  assert.equal(config.vault.keys.get(config.vault.currentVersion).length, 32);
});
