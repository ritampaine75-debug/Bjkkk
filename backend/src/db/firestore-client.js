/** Lazily initialised Firebase Admin Firestore client. */
import config from '../config.js';
import { logger } from '../utils/logger.js';

let firestoreInstance = null;
let adminApp = null;

export async function getFirebaseApp() {
  if (adminApp) return adminApp;
  if (!config.firebase.configured) throw new Error('Firebase Admin credentials are not configured.');
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const existing = getApps();
  adminApp =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential: cert({
            projectId: config.firebase.projectId,
            clientEmail: config.firebase.clientEmail,
            privateKey: config.firebase.privateKey,
          }),
          projectId: config.firebase.projectId,
        });
  logger.info('firebase admin initialised', { projectId: config.firebase.projectId });
  return adminApp;
}

export async function getFirestore() {
  if (firestoreInstance) return firestoreInstance;
  const app = await getFirebaseApp();
  const { getFirestore: adminFirestore } = await import('firebase-admin/firestore');
  const db = adminFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  firestoreInstance = db;
  return db;
}

export function __resetFirebaseForTests() {
  firestoreInstance = null;
  adminApp = null;
}
