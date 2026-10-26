/**
 * Token Vault - authenticated encryption for Telegram bot tokens.
 *
 * Envelope format (JSON, versioned so keys can be rotated without schema
 * changes):
 *   {
 *     "v": 1,                    // envelope format version
 *     "kid": "1",                // encryption key version
 *     "alg": "aes-256-gcm",
 *     "iv": "<base64 12 bytes>", // unique per encryption
 *     "tag": "<base64 16 bytes>",
 *     "ct": "<base64 ciphertext>"
 *   }
 *
 * The key material lives only in server environment configuration and is never
 * persisted next to the ciphertext. Losing every configured key makes stored
 * tokens unrecoverable - back the keys up in a managed secret store.
 */
import crypto from 'node:crypto';
import config from '../config.js';

const ENVELOPE_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class VaultError extends Error {
  constructor(message, code = 'vault_error') {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

function resolveKey(keyVersion) {
  const key = config.vault.keys.get(String(keyVersion));
  if (!key) {
    throw new VaultError(
      `No encryption key configured for key version ${keyVersion}. The stored token cannot be decrypted with the current KEY configuration.`,
      'unknown_key_version',
    );
  }
  return key;
}

/** Encrypt a secret with the current write key. */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new VaultError('Cannot encrypt an empty secret.', 'empty_secret');
  }
  const keyVersion = config.vault.currentVersion;
  const key = resolveKey(keyVersion);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    kid: String(keyVersion),
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
}

/** Decrypt an envelope produced by encryptSecret(). */
export function decryptSecret(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new VaultError('The stored secret record is missing or malformed.', 'invalid_envelope');
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new VaultError(`Unsupported secret envelope version: ${envelope.v}`, 'unsupported_envelope');
  }
  if (envelope.alg !== ALGORITHM) {
    throw new VaultError('Unsupported secret encryption algorithm.', 'unsupported_algorithm');
  }
  const key = resolveKey(envelope.kid);
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const ciphertext = Buffer.from(String(envelope.ct || ''), 'base64');
  if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
    throw new VaultError('The stored secret record is corrupted.', 'corrupt_envelope');
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new VaultError(
      'The stored token could not be decrypted. The encryption key may have changed.',
      'decryption_failed',
    );
  }
}

/** True when an envelope was written with a key older than the current one. */
export function needsRotation(envelope) {
  return Boolean(envelope) && String(envelope.kid) !== String(config.vault.currentVersion);
}

/** Re-encrypt with the current key after a key rotation. */
export function rotateEnvelope(envelope) {
  return encryptSecret(decryptSecret(envelope));
}

/** Non-reversible fingerprint used for diagnostics and duplicate detection. */
export function fingerprintSecret(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex').slice(0, 16);
}

/**
 * Display-safe mask. Telegram tokens are `<botId>:<secret>`; the bot id is
 * public metadata, the secret half is never exposed.
 */
export function maskBotToken(token) {
  const raw = String(token || '');
  const [botId] = raw.split(':');
  const last4 = raw.slice(-4);
  if (!raw.includes(':')) return '••••••••';
  return `${botId}:••••••••${last4}`;
}

export function vaultStatus() {
  return {
    configured: config.vault.keys.size > 0,
    ephemeralDevelopmentKey: config.vault.ephemeral,
    currentKeyVersion: String(config.vault.currentVersion),
    keyVersions: [...config.vault.keys.keys()].sort(),
    algorithm: ALGORITHM,
    envelopeVersion: ENVELOPE_VERSION,
  };
}
