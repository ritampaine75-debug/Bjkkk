/**
 * Development-only email/password authentication.
 *
 * This exists so the studio can be run end-to-end without a Firebase project.
 * It is refused outright when NODE_ENV=production (see config validation).
 * Passwords are hashed with scrypt and never logged or returned.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { userRepo } from '../repositories/index.js';
import { AppError, badRequest, unauthorized, conflict } from '../utils/errors.js';
import { newId } from '../utils/ids.js';

const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function validateSignupInput({ email, password, displayName }) {
  const errors = [];
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    errors.push({ field: 'email', message: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    errors.push({ field: 'password', message: 'Password must be at least 8 characters.' });
  }
  if (typeof password === 'string' && password.length > 200) {
    errors.push({ field: 'password', message: 'Password is too long.' });
  }
  if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length > 80)) {
    errors.push({ field: 'displayName', message: 'Display name must be 80 characters or fewer.' });
  }
  if (errors.length > 0) {
    throw new AppError('Please correct the highlighted fields.', {
      status: 422,
      code: 'validation_failed',
      details: errors,
    });
  }
}

export function issueSession(user) {
  return jwt.sign(
    {
      sub: user.uid,
      email: user.email,
      name: user.displayName,
      typ: 'session',
      iss: 'botforge-studio',
    },
    config.auth.localSecret,
    { expiresIn: config.auth.sessionTtlSeconds, algorithm: 'HS256' },
  );
}

export async function signUp({ email, password, displayName }) {
  assertLocalMode();
  validateSignupInput({ email, password, displayName });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await userRepo.findCredentialsByEmail(normalizedEmail);
  if (existing) throw conflict('An account with this email already exists.');

  const uid = newId('usr');
  const { salt, hash } = hashPassword(password);
  await userRepo.setCredentials(uid, { email: normalizedEmail, salt, passwordHash: hash });
  const user = await userRepo.upsert(uid, {
    email: normalizedEmail,
    displayName: (displayName || normalizedEmail.split('@')[0]).trim(),
    authProvider: 'local',
  });
  return { user, token: issueSession(user) };
}

export async function signIn({ email, password }) {
  assertLocalMode();
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw badRequest('Email and password are required.');
  }
  const normalizedEmail = email.trim().toLowerCase();
  const record = await userRepo.findCredentialsByEmail(normalizedEmail);
  // Constant-ish response to avoid account enumeration.
  if (!record || !verifyPassword(password, record.salt, record.passwordHash)) {
    throw unauthorized('Incorrect email or password.');
  }
  const user = await userRepo.upsert(record.uid, {
    email: normalizedEmail,
    displayName: record.displayName,
    authProvider: 'local',
  });
  return { user, token: issueSession(user) };
}

function assertLocalMode() {
  if (config.auth.mode !== 'local') {
    throw new AppError('Local authentication is disabled. Use Firebase Authentication.', {
      status: 400,
      code: 'auth_mode_mismatch',
    });
  }
  if (config.isProduction) {
    throw new AppError('Local authentication is not available in production.', {
      status: 403,
      code: 'auth_mode_forbidden',
    });
  }
}
