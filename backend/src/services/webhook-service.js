/**
 * Telegram webhook lifecycle management.
 *
 * Security model:
 *  - the webhook URL carries a random capability key that is stored only as a
 *    SHA-256 hash, so a database reader cannot forge deliveries;
 *  - the same key is passed to Telegram as `secret_token`, and incoming
 *    requests must echo it in `X-Telegram-Bot-Api-Secret-Token`;
 *  - the public URL shown in the UI is masked.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { botRepo, webhookRouteRepo, auditRepo } from '../repositories/index.js';
import { getBotTelegramClient } from './bot-client.js';
import { telegramErrorToAppError } from './telegram-api.js';
import { AppError, notFound } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import config from '../config.js';

export const WEBHOOK_PATH_PREFIX = '/api/v1/telegram/webhook';
const ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'];

export function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The externally reachable base URL used to build webhook URLs. */
export function publicBaseUrl() {
  return (config.telegram.webhookBaseUrl || config.appBaseUrl || '').replace(/\/+$/, '');
}

export function maskedUrl(url) {
  if (!url) return null;
  const parts = url.split('/');
  const key = parts.pop();
  return `${parts.join('/')}/${key.slice(0, 4)}${'•'.repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

export function buildWebhookUrl(botId, key, base = publicBaseUrl()) {
  return `${base}${WEBHOOK_PATH_PREFIX}/${botId}/${key}`;
}

async function audit(uid, botId, action, details = {}) {
  try {
    await auditRepo.record(uid, { action, botId, ...details });
  } catch (err) {
    logger.warn('audit write failed', { action, message: err.message });
  }
}

/** Register (or refresh) the webhook for a bot. Returns the masked status. */
export async function registerWebhook(uid, botId, { dropPendingUpdates = false, options = {} } = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  const base = publicBaseUrl();
  if (!base) {
    throw new AppError(
      'No public base URL is configured, so Telegram cannot reach this server. Set TELEGRAM_WEBHOOK_BASE_URL (or APP_BASE_URL) to your HTTPS deployment URL.',
      { status: 409, code: 'webhook_base_url_missing' },
    );
  }
  if (!/^https:\/\//.test(base) && config.env !== 'test') {
    throw new AppError('Telegram only accepts HTTPS webhook URLs. Configure an HTTPS base URL.', {
      status: 409,
      code: 'webhook_requires_https',
    });
  }

  const { client } = await getBotTelegramClient(uid, botId, options);
  const key = randomBytes(24).toString('base64url');
  const url = buildWebhookUrl(botId, key, base);

  try {
    await client.setWebhook(url, {
      secret_token: key,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: dropPendingUpdates === true,
      max_connections: 40,
    });
  } catch (err) {
    await botRepo.update(uid, botId, {
      webhook: {
        state: 'error',
        url: null,
        registeredAt: bot.webhook?.registeredAt || null,
        lastError: { code: err.code || 'webhook_registration_failed', message: err.message, at: nowIso() },
      },
    });
    throw telegramErrorToAppError(err, { fallbackStatus: 502 });
  }

  const registeredAt = nowIso();
  await webhookRouteRepo.set(botId, { uid, keyHash: hashKey(key), createdAt: registeredAt });
  await botRepo.update(uid, botId, {
    webhook: { state: 'active', url, registeredAt, lastError: null },
  });
  await audit(uid, botId, 'webhook.registered');

  return {
    webhook: {
      state: 'active',
      url: maskedUrl(url),
      registeredAt,
      allowedUpdates: ALLOWED_UPDATES,
      secretTokenConfigured: true,
      lastError: null,
    },
  };
}

/** Remove the webhook both locally and at Telegram. */
export async function removeWebhook(uid, botId, { options = {} } = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  let telegramError = null;
  try {
    const { client } = await getBotTelegramClient(uid, botId, options);
    await client.deleteWebhook();
  } catch (err) {
    telegramError = { code: err.code || 'telegram_error', message: err.message };
    logger.warn('deleteWebhook failed', { botId, code: err.code });
  }

  await webhookRouteRepo.delete(botId);
  await botRepo.update(uid, botId, {
    webhook: { state: 'not_configured', url: null, registeredAt: null, lastError: null },
  });
  await audit(uid, botId, 'webhook.removed', telegramError ? { telegramError } : {});

  return { webhook: { state: 'not_configured', url: null, registeredAt: null, lastError: telegramError } };
}

/** Local + Telegram-reported webhook state for the settings screen. */
export async function getWebhookStatus(uid, botId, { options = {} } = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const route = await webhookRouteRepo.get(botId);
  const state = {
    state: bot.webhook?.state || 'not_configured',
    url: bot.webhook?.url ? maskedUrl(bot.webhook.url) : null,
    registeredAt: bot.webhook?.registeredAt || null,
    lastError: bot.webhook?.lastError || null,
    baseUrlConfigured: Boolean(publicBaseUrl()),
    routeRegistered: Boolean(route?.keyHash),
    secretTokenConfigured: Boolean(route?.keyHash),
    allowedUpdates: ALLOWED_UPDATES,
    telegram: null,
  };
  try {
    const { client } = await getBotTelegramClient(uid, botId, options);
    const { result } = await client.getWebhookInfo();
    state.telegram = {
      url: result?.url ? maskedUrl(result.url) : '',
      pendingUpdateCount: result?.pending_update_count ?? 0,
      lastErrorMessage: result?.last_error_message || null,
      lastErrorDate: result?.last_error_date || null,
      maxConnections: result?.max_connections ?? null,
    };
  } catch (err) {
    state.telegram = { error: { code: err.code || 'telegram_error', message: err.message } };
  }
  return { webhook: state };
}

/**
 * Verify a delivery: resolves the owning uid for a bot id and checks the
 * capability key. Returns null when the request must be rejected.
 */
export async function resolveWebhookRoute(botId, key) {
  if (typeof botId !== 'string' || typeof key !== 'string' || key.length < 16) return null;
  const route = await webhookRouteRepo.get(botId);
  if (!route?.keyHash) return null;
  if (!safeEqual(hashKey(key), route.keyHash)) return null;
  return { uid: route.uid, botId };
}

export { safeEqual as __safeEqual };
