/**
 * Public Firebase client config wiring. These values are not secrets - they
 * identify the project and are meant to reach the browser - so they must be
 * served, while the Admin credentials must never be.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('the public Firebase client config is documented and shipped in .env.example', () => {
  const env = read('.env.example');
  for (const key of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_DATABASE_URL',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_PROJECT_ID',
  ]) {
    assert.match(env, new RegExp(`^${key}=.+$`, 'm'), `${key} should have a documented value`);
  }
  const setup = read('docs/FIREBASE-SETUP.md');
  assert.match(setup, /hiiii-72d78\.firebaseapp\.com/);
  assert.match(setup, /apiKey: "AIza/);
});

test('admin credentials are requested but never given example values', () => {
  const env = read('.env.example');
  assert.match(env, /^FIREBASE_CLIENT_EMAIL=$/m);
  assert.match(env, /^FIREBASE_PRIVATE_KEY=$/m);
  assert.match(env, /^TOKEN_ENCRYPTION_KEY=$/m);
});

test('the committed rules deny Firestore and Storage client access', () => {
  assert.match(read('firebase/firestore.rules'), /allow read, write: if false;/);
  assert.match(read('firebase/storage.rules'), /allow read, write: if false;/);
});

test('the Realtime Database rules are the documented open defaults', () => {
  const rules = JSON.parse(read('firebase/database.rules.json'));
  assert.equal(rules.rules['.read'], true);
  assert.equal(rules.rules['.write'], true);
  // The risk must be documented wherever the rules are deployed from.
  assert.match(read('docs/FIREBASE-SETUP.md'), /Security warning/);
  assert.match(read('docs/SECURITY.md'), /Realtime Database rules reviewed/);
});

test('firebase.json registers every rules file that exists in the repo', () => {
  const config = JSON.parse(read('firebase/firebase.json'));
  const files = [
    config.firestore.rules,
    config.firestore.indexes,
    config.storage.rules,
    config.database.rules,
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'firebase', file)), `${file} should exist`);
  }
});
