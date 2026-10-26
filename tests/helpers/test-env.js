/** Shared test environment bootstrap. Must run before app modules load. */
import crypto from 'node:crypto';

process.env.BOTFORGE_SKIP_DOTENV = '1';
process.env.NODE_ENV = 'test';
process.env.AUTH_MODE = 'local';
process.env.DB_MODE = 'json';
process.env.LOCAL_AUTH_SECRET = 'test-secret-test-secret-test-secret-32';
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.TOKEN_ENCRYPTION_KEY_VERSION = '1';
process.env.LOG_LEVEL = 'error';
process.env.TELEGRAM_API_BASE_URL = 'https://api.telegram.test';
process.env.TELEGRAM_WEBHOOK_BASE_URL = 'https://bots.example.test';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';

export async function freshStores() {
  const { resetStoreForTests } = await import('../../backend/src/db/index.js');
  return resetStoreForTests();
}

export async function makeApp() {
  const { createApp } = await import('../../backend/src/app.js');
  return createApp();
}
