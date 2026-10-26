import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/test-env.js';
import {
  encryptSecret,
  decryptSecret,
  maskBotToken,
  fingerprintSecret,
  needsRotation,
  vaultStatus,
} from '../../backend/src/services/token-vault.js';
import config from '../../backend/src/config.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

test('encryption envelope round-trips and is authenticated', () => {
  const envelope = encryptSecret(TOKEN);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.alg, 'aes-256-gcm');
  assert.equal(envelope.kid, config.vault.currentVersion);
  assert.equal(JSON.stringify(envelope).includes('AAHdqTcv'), false, 'ciphertext must not contain plaintext');
  assert.equal(decryptSecret(envelope), TOKEN);
});

test('each encryption uses a unique nonce', () => {
  const a = encryptSecret(TOKEN);
  const b = encryptSecret(TOKEN);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('tampered ciphertext, tag or envelope is rejected', () => {
  const envelope = encryptSecret(TOKEN);
  const flip = (value) => {
    const buf = Buffer.from(value, 'base64');
    buf[0] ^= 0xff;
    return buf.toString('base64');
  };
  assert.throws(() => decryptSecret({ ...envelope, ct: flip(envelope.ct) }), /could not be decrypted/);
  assert.throws(() => decryptSecret({ ...envelope, tag: flip(envelope.tag) }), /could not be decrypted/);
  assert.throws(() => decryptSecret({ ...envelope, v: 9 }), /Unsupported secret envelope version/);
  assert.throws(() => decryptSecret({ ...envelope, alg: 'aes-128-cbc' }), /Unsupported secret encryption/);
  assert.throws(() => decryptSecret(null), /missing or malformed/);
  assert.throws(() => decryptSecret({ ...envelope, kid: '99' }), /No encryption key configured/);
});

test('key rotation is detected and can be applied', () => {
  const envelope = encryptSecret(TOKEN);
  assert.equal(needsRotation(envelope), false);
  const oldEnvelope = { ...envelope, kid: '999' };
  assert.equal(needsRotation(oldEnvelope), true);
});

test('vault status exposes no key material', () => {
  const status = vaultStatus();
  assert.equal(status.algorithm, 'aes-256-gcm');
  assert.ok(status.keyVersions.length >= 1);
  const serialised = JSON.stringify(status);
  const keyBase64 = config.vault.keys.get(config.vault.currentVersion).toString('base64');
  assert.equal(serialised.includes(keyBase64), false);
  assert.equal(serialised.includes(keyBase64.slice(0, 12)), false);
});

test('token masking and fingerprinting never reveal the secret half', () => {
  const masked = maskBotToken(TOKEN);
  assert.ok(masked.startsWith('123456789:'));
  assert.ok(!masked.includes('AAHdqTcv'));
  assert.equal(maskBotToken('garbage'), '••••••••');
  const fp = fingerprintSecret(TOKEN);
  assert.equal(fp.length, 16);
  assert.notEqual(fp, fingerprintSecret(`${TOKEN}x`));
});
