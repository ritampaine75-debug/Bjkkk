import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import * as localAuth from '../services/local-auth.js';
import config from '../config.js';
import { userRepo } from '../repositories/index.js';
import { badRequest } from '../utils/errors.js';

const router = express.Router();

/** Public auth configuration the browser needs to start the sign-in flow. */
router.get('/config', (_req, res) => {
  res.json({
    mode: config.auth.mode,
    firebase:
      config.auth.mode === 'firebase'
        ? {
            apiKey: config.auth.firebaseApiKey,
            authDomain: config.auth.firebaseAuthDomain,
            projectId: config.auth.firebaseProjectId,
            databaseURL: config.auth.firebaseDatabaseURL || null,
            storageBucket: config.auth.firebaseStorageBucket || null,
            messagingSenderId: config.auth.firebaseMessagingSenderId || null,
            appId: config.auth.firebaseAppId || null,
          }
        : null,
    allowSignup: config.auth.mode === 'local',
    demoMode: config.isDevelopment && config.auth.mode === 'local',
  });
});

router.post('/register', sensitiveLimiter, async (req, res, next) => {
  try {
    const { user, token } = await localAuth.signUp(req.body || {});
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', sensitiveLimiter, async (req, res, next) => {
  try {
    const { user, token } = await localAuth.signIn(req.body || {});
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * Firebase mode: the browser signs in with the Firebase SDK and posts the ID
 * token here to exchange it for a server session profile. Ownership is still
 * enforced per request by verifying the ID token directly.
 */
router.post('/session', authenticate, async (req, res) => {
  res.json({ user: publicUser(req.user.record || req.user) });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: publicUser(req.user.record || req.user) });
});

router.patch('/me/preferences', authenticate, async (req, res, next) => {
  try {
    const theme = req.body?.theme;
    if (theme !== undefined && !['light', 'dark', 'system'].includes(theme)) {
      throw badRequest('theme must be light, dark or system.');
    }
    const preferences = await userRepo.updatePreferences(req.user.uid, { theme });
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, (_req, res) => {
  // Sessions are stateless JWTs; the browser discards the token. Firebase mode
  // revokes the refresh token client-side with the Firebase SDK.
  res.status(204).end();
});

function publicUser(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    authProvider: user.authProvider || 'local',
    preferences: user.preferences || { theme: 'system' },
    createdAt: user.createdAt || null,
  };
}

export default router;
