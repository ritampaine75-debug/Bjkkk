/**
 * Application authentication middleware.
 *
 * AUTH_MODE=firebase : verifies Firebase Auth ID tokens with the Admin SDK.
 * AUTH_MODE=local    : development-only signed session tokens.
 *
 * On success req.user = { uid, email, displayName, photoURL, authProvider }.
 */
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { unauthorized } from '../utils/errors.js';
import { userRepo } from '../repositories/index.js';
import { logger } from '../utils/logger.js';

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

let firebaseAuthModule = null;
async function verifyFirebaseIdToken(token) {
  if (!firebaseAuthModule) {
    const { getFirebaseApp } = await import('../db/firestore-client.js');
    await getFirebaseApp();
    firebaseAuthModule = await import('firebase-admin/auth');
  }
  return firebaseAuthModule.getAuth().verifyIdToken(token, true);
}

export async function authenticate(req, _res, next) {
  try {
    const token = bearerToken(req);
    if (!token) throw unauthorized('A bearer token is required.');

    let identity;
    if (config.auth.mode === 'firebase') {
      let decoded;
      try {
        decoded = await verifyFirebaseIdToken(token);
      } catch (err) {
        logger.warn('firebase token verification failed', { code: err.code });
        throw unauthorized('Your session is invalid or has expired. Please sign in again.');
      }
      identity = {
        uid: decoded.uid,
        email: decoded.email || '',
        displayName: decoded.name || '',
        photoURL: decoded.picture || '',
        authProvider: decoded.firebase?.sign_in_provider || 'firebase',
      };
    } else {
      let payload;
      try {
        payload = jwt.verify(token, config.auth.localSecret, { algorithms: ['HS256'] });
      } catch {
        throw unauthorized('Your session is invalid or has expired. Please sign in again.');
      }
      if (payload.iss !== 'botforge-studio' || payload.typ !== 'session') {
        throw unauthorized('Your session is invalid.');
      }
      identity = {
        uid: payload.sub,
        email: payload.email || '',
        displayName: payload.name || '',
        photoURL: '',
        authProvider: 'local',
      };
    }

    const user = await userRepo.upsert(identity.uid, identity);
    req.user = { ...identity, record: user };
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/** Reject the request unless it carries a fully authenticated user record. */
export function requireUser(req, _res, next) {
  if (!req.user?.uid) return next(unauthorized());
  return next();
}
