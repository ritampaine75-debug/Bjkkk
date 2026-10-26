#!/usr/bin/env node
/**
 * Preflight for the Firebase configuration.
 *
 * Verifies that the Admin SDK credentials are present and that a Firestore
 * round-trip works, without ever printing a private key. Prints the public
 * client config (not a secret) so the browser config can be compared.
 *
 * Usage: node backend/scripts/check-firebase.js
 */
import config, { assertValidConfig } from '../src/config.js';
import { getStore } from '../src/db/index.js';

async function main() {
  assertValidConfig();
  console.log(`auth mode   : ${config.auth.mode}`);
  console.log(`db mode     : ${config.db.mode}`);
  console.log(`project id  : ${config.firebase.projectId || '(not set)'}`);
  console.log(`admin creds : ${config.firebase.configured ? 'present' : 'MISSING'}`);
  console.log(`client key  : ${config.auth.firebaseApiKey ? `${config.auth.firebaseApiKey.slice(0, 8)}…` : '(not set)'}`);
  console.log(`databaseURL : ${config.auth.firebaseDatabaseURL || '(not set)'}`);

  const store = await getStore();
  const probePath = `_healthcheck/botforge_${Date.now()}`;
  await store.doc.set(probePath, { ok: true });
  const read = await store.doc.get(probePath);
  await store.doc.delete(probePath);

  if (!read?.ok) throw new Error('Store round-trip failed: the document could not be read back.');
  console.log('store       : read/write round-trip OK');
}

main().catch((err) => {
  console.error(`Firebase check failed: ${err.message}`);
  process.exit(1);
});
