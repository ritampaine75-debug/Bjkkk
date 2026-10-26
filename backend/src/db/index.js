/**
 * Storage factory. Chooses Firestore (production) or the JSON development
 * store. Tests may inject a store directly through setStore().
 */
import config from '../config.js';
import { JsonStore } from './json-store.js';
import { logger } from '../utils/logger.js';

let store = null;

export async function createStore(options = {}) {
  const mode = options.mode || config.db.mode;
  if (mode === 'firestore') {
    const { getFirestore } = await import('./firestore-client.js');
    const db = await getFirestore();
    const { FirestoreStore } = await import('./firestore-store.js');
    return new FirestoreStore({ db });
  }
  const filePath = 'filePath' in options ? options.filePath : config.db.jsonPath;
  return new JsonStore({ filePath, documents: options.documents });
}

export async function getStore() {
  if (!store) {
    store = await createStore();
    logger.info('storage initialised', { mode: store.kind });
  }
  return store;
}

export function setStore(nextStore) {
  store = nextStore;
  return store;
}

export async function resetStoreForTests() {
  store = await createStore({ mode: 'json', filePath: null });
  return store;
}
