/**
 * Central environment configuration for BotForge Studio.
 * All privileged values live here and are never sent to the browser.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load .env from the repository root unless the test harness supplies env.
if (process.env.BOTFORGE_SKIP_DOTENV !== '1') {
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });
}

function str(name, fallback = '') {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  return String(raw).trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback = false) {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function list(name) {
  return str(name)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const firebaseConfigured = Boolean(
  str('FIREBASE_PROJECT_ID') && str('FIREBASE_CLIENT_EMAIL') && str('FIREBASE_PRIVATE_KEY'),
);

const warnings = [];
const errors = [];

function resolveAuthMode() {
  const requested = str('AUTH_MODE', firebaseConfigured ? 'firebase' : 'local').toLowerCase();
  if (requested === 'firebase' && !firebaseConfigured) {
    if (isProduction) {
      errors.push(
        'AUTH_MODE=firebase requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
      );
    }
    return 'local';
  }
  if (requested === 'local' && isProduction) {
    errors.push(
      'AUTH_MODE=local is a development-only authentication mode and is refused when NODE_ENV=production. Configure Firebase Authentication instead.',
    );
  }
  return requested === 'firebase' ? 'firebase' : 'local';
}

function resolveDbMode() {
  const requested = str('DB_MODE', firebaseConfigured ? 'firestore' : 'json').toLowerCase();
  if (requested === 'firestore') {
    if (!firebaseConfigured) {
      if (isProduction) {
        errors.push(
          'DB_MODE=firestore requires Firebase Admin credentials (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).',
        );
      } else {
        warnings.push('DB_MODE=firestore requested without Firebase credentials; using the JSON development store.');
      }
      return 'json';
    }
    return 'firestore';
  }
  if (requested !== 'json') {
    errors.push(`DB_MODE must be "firestore" or "json" (received "${requested}").`);
  }
  if (isProduction && requested === 'json') {
    errors.push('DB_MODE=json is a local development store and must not be used with NODE_ENV=production.');
  }
  return 'json';
}

const authMode = resolveAuthMode();
const dbMode = resolveDbMode();

const localAuthSecret = str('LOCAL_AUTH_SECRET');
if (authMode === 'local') {
  if (!localAuthSecret || localAuthSecret.length < 32) {
    if (isProduction) {
      errors.push('LOCAL_AUTH_SECRET must be at least 32 characters when AUTH_MODE=local.');
    } else if (!isTest) {
      warnings.push('LOCAL_AUTH_SECRET is missing or short; using an ephemeral development secret (sessions reset on restart).');
    }
  }
}

function resolveTokenEncryptionKeys() {
  const keys = new Map();
  const current = str('TOKEN_ENCRYPTION_KEY');
  const currentVersion = int('TOKEN_ENCRYPTION_KEY_VERSION', 1);
  let ephemeral = false;

  const addKey = (rawValue, version, source) => {
    if (!rawValue) return;
    const buf = Buffer.from(rawValue, 'base64');
    if (buf.length !== 32) {
      errors.push(`${source} must be a base64-encoded 32 byte key (AES-256).`);
      return;
    }
    keys.set(String(version), buf);
  };

  addKey(current, currentVersion, 'TOKEN_ENCRYPTION_KEY');
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^TOKEN_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (m && value) addKey(String(value).trim(), m[1], name);
  }

  if (keys.size === 0) {
    if (isProduction) {
      errors.push(
        'TOKEN_ENCRYPTION_KEY is required in production. Bot tokens must never be stored without authenticated encryption.',
      );
    } else {
      // Development convenience only: an ephemeral key keeps the developer flow
      // working, but stored offsets cannot be decrypted after a restart.
      const devKey = crypto.createHash('sha256').update('botforge-dev-vault-key').digest();
      keys.set(String(currentVersion), devKey);
      ephemeral = true;
      if (!isTest) {
        warnings.push(
          'TOKEN_ENCRYPTION_KEY is not set. Using a fixed development key; configure a real key before storing production bot tokens.',
        );
      }
    }
  }
  if (!keys.has(String(currentVersion))) {
    // write key must exist
    const first = keys.keys().next().value;
    if (first) keys.set(String(currentVersion), keys.get(first));
  }
  return { keys, currentVersion: String(currentVersion), ephemeral };
}

const vault = resolveTokenEncryptionKeys();

const allowedOrigins = list('ALLOWED_ORIGINS');

const config = Object.freeze({
  env: nodeEnv,
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,
  port: int('PORT', 8080),
  appBaseUrl: str('APP_BASE_URL', `http://localhost:${int('PORT', 8080)}`).replace(/\/+$/, ''),
  auth: Object.freeze({
    mode: authMode,
    localSecret: localAuthSecret || crypto.createHash('sha256').update('botforge-dev-auth').digest('hex'),
    sessionTtlSeconds: int('LOCAL_AUTH_SESSION_TTL_SECONDS', 60 * 60 * 24 * 7),
    firebaseApiKey: str('FIREBASE_API_KEY'),
    firebaseAuthDomain: str('FIREBASE_AUTH_DOMAIN'),
    firebaseProjectId: str('FIREBASE_PROJECT_ID'),
    // Additional PUBLIC Firebase client identifiers. These are not secrets:
    // they ship to the browser by design. Admin credentials never appear here.
    firebaseDatabaseURL: str('FIREBASE_DATABASE_URL'),
    firebaseStorageBucket: str('FIREBASE_STORAGE_BUCKET'),
    firebaseMessagingSenderId: str('FIREBASE_MESSAGING_SENDER_ID'),
    firebaseAppId: str('FIREBASE_APP_ID'),
  }),
  firebase: Object.freeze({
    configured: firebaseConfigured,
    projectId: str('FIREBASE_PROJECT_ID'),
    clientEmail: str('FIREBASE_CLIENT_EMAIL'),
    privateKey: str('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }),
  db: Object.freeze({
    mode: dbMode,
    jsonPath: path.resolve(REPO_ROOT, str('JSON_DB_PATH', 'backend/.data/db.json')),
    firestorePrefix: str('FIRESTORE_COLLECTION_PREFIX', ''),
  }),
  vault: Object.freeze({
    keys: vault.keys,
    currentVersion: vault.currentVersion,
    ephemeral: vault.ephemeral,
  }),
  telegram: Object.freeze({
    apiBaseUrl: str('TELEGRAM_API_BASE_URL', 'https://api.telegram.org').replace(/\/+$/, ''),
    webhookBaseUrl: str('TELEGRAM_WEBHOOK_BASE_URL', '').replace(/\/+$/, ''),
    webhookSecret: str('TELEGRAM_WEBHOOK_SECRET'),
    timeoutMs: int('TELEGRAM_API_TIMEOUT_MS', 10000),
  }),
  security: Object.freeze({
    allowedOrigins,
    rateLimitWindowSeconds: int('RATE_LIMIT_WINDOW_SECONDS', 60),
    rateLimitMaxRequests: int('RATE_LIMIT_MAX_REQUESTS', 120),
    connectRateLimitMaxRequests: int('CONNECT_RATE_LIMIT_MAX_REQUESTS', 10),
    maxJsonBodyBytes: int('MAX_JSON_BODY_BYTES', 256 * 1024),
    trustProxy: int('TRUST_PROXY', 0),
  }),
  runtime: Object.freeze({
    executionTimeoutMs: int('EXECUTION_TIMEOUT_MS', 15000),
    executionMaxSteps: int('EXECUTION_MAX_STEPS', 60),
    executionMaxDepth: int('EXECUTION_MAX_DEPTH', 24),
    queueConcurrency: int('QUEUE_CONCURRENCY', 4),
    executionRetentionDays: int('EXECUTION_RETENTION_DAYS', 30),
    schedulerEnabled: bool('SCHEDULER_ENABLED', false),
    schedulerTickSeconds: int('SCHEDULER_TICK_SECONDS', 30),
  }),
  warnings: Object.freeze(warnings),
  errors: Object.freeze(errors),
});

/** Throw a descriptive error when the environment cannot run safely. */
export function assertValidConfig() {
  if (config.errors.length > 0) {
    const err = new Error(`Invalid configuration:\n - ${config.errors.join('\n - ')}`);
    err.code = 'CONFIG_INVALID';
    err.details = config.errors;
    throw err;
  }
  return config;
}

export default config;
