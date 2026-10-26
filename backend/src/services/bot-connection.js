/**
 * Bot connection service: validates tokens against Telegram, stores them in the
 * encrypted vault and keeps connection metadata accurate.
 *
 * Rules enforced here:
 *  - a submitted token is never logged, returned or stored in plaintext;
 *  - a bot that is already linked to the account produces a conflict pointing
 *    at the existing workspace instead of a duplicate record;
 *  - connection state degrades honestly (invalid_token / error) rather than
 *    reporting a stale success.
 */
import {
  createTelegramClient,
  parseBotIdentity,
  isPlausibleBotToken,
  TelegramError,
} from './telegram-api.js';
import { encryptSecret, decryptSecret, maskBotToken, fingerprintSecret, needsRotation } from './token-vault.js';
import { botRepo, botSecretRepo, workflowRepo, executionRepo, auditRepo } from '../repositories/index.js';
import { badRequest, conflict, notFound, AppError } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { BOT_ENVIRONMENT, BOT_CONNECTION_STATE, WORKFLOW_STATUS } from '../../../shared/constants.js';

const ENVIRONMENTS = Object.values(BOT_ENVIRONMENT);

/** Public, safe representation of a bot. Never contains the token or envelope. */
export function publicBot(bot, extra = {}) {
  if (!bot) return null;
  return {
    id: bot.id,
    displayName: bot.displayName,
    environment: bot.environment,
    status: bot.status,
    telegram: {
      id: bot.telegram?.id || null,
      username: bot.telegram?.username || null,
      firstName: bot.telegram?.firstName || null,
      canJoinGroups: bot.telegram?.canJoinGroups ?? null,
      canReadAllGroupMessages: bot.telegram?.canReadAllGroupMessages ?? null,
      supportsInlineQueries: bot.telegram?.supportsInlineQueries ?? null,
    },
    tokenMask: bot.tokenMask || null,
    tokenUpdatedAt: bot.tokenUpdatedAt || null,
    connection: {
      state: bot.connection?.state || BOT_CONNECTION_STATE.UNKNOWN,
      lastCheckedAt: bot.connection?.lastCheckedAt || null,
      lastError: bot.connection?.lastError || null,
    },
    activity: {
      lastUpdateAt: bot.activity?.lastUpdateAt || null,
      lastExecutionAt: bot.activity?.lastExecutionAt || null,
      updateCount: bot.activity?.updateCount || 0,
    },
    webhook: {
      state: bot.webhook?.state || 'not_configured',
      url: bot.webhook?.url || null,
      registeredAt: bot.webhook?.registeredAt || null,
      lastError: bot.webhook?.lastError || null,
    },
    restrictions: {
      mode: bot.restrictions?.mode || 'everyone',
      userIds: bot.restrictions?.userIds || [],
    },
    commandsSyncedAt: bot.commandsSyncedAt || null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    ...extra,
  };
}

function clientForToken(token, options = {}) {
  return createTelegramClient({ token, ...options });
}

function safeTelegramFailure(err) {
  return {
    code: err.code || 'telegram_error',
    message: err.message,
    retryAfter: err.retryAfter || null,
  };
}

async function audit(uid, botId, action, details = {}) {
  try {
    await auditRepo.record(uid, { action, botId, ...details });
  } catch (err) {
    logger.warn('audit write failed', { action, message: err.message });
  }
}

/**
 * Connect a bot using a BotFather token.
 */
export async function connectBot(uid, input, options = {}) {
  const { token, displayName, environment = BOT_ENVIRONMENT.DEVELOPMENT, acknowledgeOwnership } = input || {};

  if (acknowledgeOwnership !== true) {
    throw badRequest('You must confirm that you own or are authorised to administer this bot.');
  }
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw badRequest('A bot token is required.');
  }
  if (token.length > 200) {
    throw badRequest('The bot token is too long.');
  }
  if (!isPlausibleBotToken(token)) {
    throw new AppError(
      'That does not look like a Telegram bot token. Copy the full token from BotFather (format: 123456789:ABC...).',
      { status: 422, code: 'invalid_token_format' },
    );
  }
  if (environment !== undefined && !ENVIRONMENTS.includes(environment)) {
    throw badRequest(`environment must be one of: ${ENVIRONMENTS.join(', ')}`);
  }
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || displayName.trim().length > 80) {
      throw badRequest('The display name must be 80 characters or fewer.');
    }
  }

  const trimmedToken = token.trim();
  const client = clientForToken(trimmedToken, options);

  let identity;
  try {
    const { result } = await client.getMe();
    identity = parseBotIdentity(result);
  } catch (err) {
    if (err instanceof TelegramError) {
      logger.warn('bot connection rejected by telegram', { uid, code: err.code });
      const status = err.code === 'invalid_token' ? 422 : err.code === 'rate_limited' ? 429 : 502;
      throw new AppError(err.message, { status, code: err.code });
    }
    throw err;
  }

  const existing = await botRepo.findByTelegramId(uid, identity.id);
  if (existing) {
    throw conflict('This bot is already connected to your account.', {
      existingBotId: existing.id,
      existingBotName: existing.displayName,
    });
  }

  const secret = {
    envelope: encryptSecret(trimmedToken),
    fingerprint: fingerprintSecret(trimmedToken),
    mask: maskBotToken(trimmedToken),
    createdAt: nowIso(),
    rotatedAt: null,
  };

  const bot = await botRepo.create(uid, {
    displayName: (displayName && displayName.trim()) || identity.firstName || identity.username || 'Telegram bot',
    environment,
    status: 'active',
    telegram: identity,
    tokenMask: secret.mask,
    tokenUpdatedAt: secret.createdAt,
    connection: {
      state: BOT_CONNECTION_STATE.CONNECTED,
      lastCheckedAt: nowIso(),
      lastError: null,
    },
    activity: { lastUpdateAt: null, lastExecutionAt: null, updateCount: 0 },
    webhook: { state: 'not_configured', url: null, registeredAt: null, lastError: null },
    commandsSyncedAt: null,
  });

  await botSecretRepo.set(bot.id, { ...secret, uid });
  await audit(uid, bot.id, 'bot.connected', { telegramId: identity.id, environment });

  logger.info('bot connected', { uid, botId: bot.id, telegramId: identity.id });
  return publicBot(bot, { duplicateOf: null });
}

/** Re-validate a stored token and refresh the detected bot profile. */
export async function revalidateBot(uid, botId, options = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  const secret = await botSecretRepo.get(botId);
  if (!secret?.envelope) {
    const updated = await botRepo.update(uid, botId, {
      connection: { state: BOT_CONNECTION_STATE.INVALID_TOKEN, lastCheckedAt: nowIso(), lastError: { code: 'missing_secret', message: 'No stored token for this bot.' } },
    });
    throw new AppError('No stored token exists for this bot. Connect the bot again.', {
      status: 409,
      code: 'missing_token',
      details: { bot: publicBot(updated) },
    });
  }

  let token;
  try {
    token = decryptSecret(secret.envelope);
  } catch (err) {
    await botRepo.update(uid, botId, {
      connection: {
        state: BOT_CONNECTION_STATE.ERROR,
        lastCheckedAt: nowIso(),
        lastError: { code: err.code || 'decryption_failed', message: 'The stored token could not be decrypted.' },
      },
    });
    throw new AppError(
      'The stored token could not be decrypted. The encryption key may have changed - reconnect the bot with a fresh token.',
      { status: 500, code: 'vault_decryption_failed' },
    );
  }

  const client = clientForToken(token, options);
  try {
    const { result } = await client.getMe();
    const identity = parseBotIdentity(result);
    if (identity.id !== bot.telegram?.id) {
      throw new AppError(
        'The stored token belongs to a different bot than the one originally connected. Reconnect this workspace with the correct token.',
        { status: 409, code: 'token_identity_mismatch' },
      );
    }

    const patch = {
      telegram: identity,
      connection: { state: BOT_CONNECTION_STATE.CONNECTED, lastCheckedAt: nowIso(), lastError: null },
      tokenMask: secret.mask,
      tokenUpdatedAt: secret.rotatedAt || secret.createdAt,
    };
    let rotated = false;
    if (needsRotation(secret.envelope)) {
      const envelope = encryptSecret(token);
      await botSecretRepo.set(botId, { ...secret, envelope, rotatedAt: nowIso(), uid });
      rotated = true;
    }
    const updated = await botRepo.update(uid, botId, patch);
    await audit(uid, botId, 'bot.revalidated', { rotated });
    return { bot: publicBot(updated), rotated, vaultKeyVersion: secret.envelope.kid };
  } catch (err) {
    const failure = err instanceof TelegramError ? safeTelegramFailure(err) : { code: 'error', message: err.message };
    await botRepo.update(uid, botId, {
      connection: {
        state:
          err.code === 'invalid_token'
            ? BOT_CONNECTION_STATE.INVALID_TOKEN
            : BOT_CONNECTION_STATE.ERROR,
        lastCheckedAt: nowIso(),
        lastError: failure,
      },
    });
    await audit(uid, botId, 'bot.validation_failed', { code: failure.code });
    if (err instanceof AppError) throw err;
    throw new AppError(failure.message, {
      status: err.code === 'invalid_token' ? 422 : 502,
      code: failure.code,
    });
  }
}

/** Replace the stored token after re-validating it with Telegram. */
export async function replaceToken(uid, botId, { token, acknowledgeOwnership }, options = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  if (acknowledgeOwnership !== true) {
    throw badRequest('You must confirm you are authorised to change this bot token.');
  }
  if (!isPlausibleBotToken(token)) {
    throw new AppError('That does not look like a Telegram bot token.', {
      status: 422,
      code: 'invalid_token_format',
    });
  }
  const trimmed = String(token).trim();
  let identity;
  try {
    const { result } = await clientForToken(trimmed, options).getMe();
    identity = parseBotIdentity(result);
  } catch (err) {
    if (err instanceof TelegramError) {
      throw new AppError(err.message, { status: err.code === 'invalid_token' ? 422 : 502, code: err.code });
    }
    throw err;
  }
  if (identity.id !== bot.telegram?.id) {
    throw new AppError('This token belongs to a different bot. Use "Connect bot" to add a new bot instead.', {
      status: 409,
      code: 'token_identity_mismatch',
    });
  }
  const secret = {
    envelope: encryptSecret(trimmed),
    fingerprint: fingerprintSecret(trimmed),
    mask: maskBotToken(trimmed),
    createdAt: nowIso(),
    rotatedAt: nowIso(),
  };
  await botSecretRepo.set(botId, { ...secret, uid });
  const updated = await botRepo.update(uid, botId, {
    telegram: identity,
    tokenMask: secret.mask,
    tokenUpdatedAt: secret.createdAt,
    connection: { state: BOT_CONNECTION_STATE.CONNECTED, lastCheckedAt: nowIso(), lastError: null },
  });
  await audit(uid, botId, 'bot.token_replaced');
  return publicBot(updated);
}

/** Mark the connection revoked and delete the stored secret. */
export async function revokeBot(uid, botId, { removeWebhook = true } = {}, options = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  if (removeWebhook && bot.webhook?.url) {
    try {
      const secret = await botSecretRepo.get(botId);
      if (secret?.envelope) {
        const token = decryptSecret(secret.envelope);
        await clientForToken(token, options).deleteWebhook();
      }
    } catch (err) {
      logger.warn('could not delete webhook during revoke', { botId, code: err.code });
    }
  }

  await botSecretRepo.delete(botId);
  const updated = await botRepo.update(uid, botId, {
    tokenMask: null,
    tokenUpdatedAt: null,
    status: 'revoked',
    webhook: { state: 'not_configured', url: null, registeredAt: null, lastError: null },
    connection: {
      state: BOT_CONNECTION_STATE.REVOKED,
      lastCheckedAt: bot.connection?.lastCheckedAt || null,
      lastError: { code: 'revoked', message: 'The bot connection was revoked by the account owner.' },
    },
  });
  await audit(uid, botId, 'bot.revoked');
  return publicBot(updated);
}

export async function deleteBot(uid, botId) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  await botRepo.delete(uid, botId);
  await audit(uid, botId, 'bot.deleted', { displayName: bot.displayName });
  return true;
}

const RESTRICTION_MODES = ['everyone', 'allowlist', 'blocklist'];

/** Normalise a Telegram user id list; returns null when any entry is invalid. */
export function normalizeUserIds(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return null;
  const ids = [];
  for (const raw of input) {
    const value = String(raw).trim();
    if (!/^\d{1,20}$/.test(value)) return null;
    if (!ids.includes(value)) ids.push(value);
  }
  if (ids.length > 200) return null;
  return ids;
}

/** Bot-wide access control applied to every inbound update. */
export async function updateRestrictions(uid, botId, input = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const mode = input.mode === undefined ? (bot.restrictions?.mode || 'everyone') : String(input.mode);
  if (!RESTRICTION_MODES.includes(mode)) {
    throw badRequest(`mode must be one of: ${RESTRICTION_MODES.join(', ')}`);
  }
  const userIds = normalizeUserIds(input.userIds === undefined ? bot.restrictions?.userIds || [] : input.userIds);
  if (userIds === null) {
    throw badRequest('userIds must be a list of numeric Telegram user IDs (max 200).');
  }
  if (mode !== 'everyone' && userIds.length === 0) {
    throw badRequest('Add at least one user ID, or switch the mode back to everyone.');
  }
  const updated = await botRepo.update(uid, botId, { restrictions: { mode, userIds } });
  await audit(uid, botId, 'bot.restrictions_updated', { mode, count: userIds.length });
  return publicBot(updated);
}

export async function updateBot(uid, botId, patch) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const changes = {};
  if (patch.displayName !== undefined) {
    const name = String(patch.displayName).trim();
    if (!name) throw badRequest('The display name cannot be empty.');
    if (name.length > 80) throw badRequest('The display name must be 80 characters or fewer.');
    changes.displayName = name;
  }
  if (patch.environment !== undefined) {
    if (!ENVIRONMENTS.includes(patch.environment)) throw badRequest('Invalid environment value.');
    changes.environment = patch.environment;
  }
  if (Object.keys(changes).length === 0) throw badRequest('No supported fields were supplied.');
  const updated = await botRepo.update(uid, botId, changes);
  await audit(uid, botId, 'bot.updated', { fields: Object.keys(changes) });
  return publicBot(updated);
}

/**
 * Connection diagnostics. Anything that cannot be determined reliably is
 * reported as "unknown" rather than guessed.
 */
export async function getDiagnostics(uid, botId, options = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const secret = await botSecretRepo.get(botId);

  const info = {
    token: {
      present: Boolean(secret?.envelope),
      mask: secret?.mask || bot.tokenMask || null,
      createdAt: secret?.createdAt || null,
      rotatedAt: secret?.rotatedAt || null,
      keyVersion: secret?.envelope?.kid || null,
      needsRotation: secret?.envelope ? needsRotation(secret.envelope) : false,
      validity: secret?.envelope ? 'stored' : 'missing',
    },
    connection: {
      state: bot.connection?.state || 'unknown',
      lastCheckedAt: bot.connection?.lastCheckedAt || null,
      lastError: bot.connection?.lastError || null,
    },
    webhook: {
      state: bot.webhook?.state || 'not_configured',
      url: bot.webhook?.url || null,
      registeredAt: bot.webhook?.registeredAt || null,
      lastError: bot.webhook?.lastError || null,
      telegramReported: 'unknown',
    },
    updates: {
      lastUpdateAt: bot.activity?.lastUpdateAt || null,
      updateCount: bot.activity?.updateCount || 0,
    },
    worker: { state: 'unknown', note: 'Worker heartbeat is reported by the live runtime (Phase 6).' },
    executions: { last: null },
  };

  const workflows = await workflowRepo.list(uid, botId);
  info.workflows = {
    total: workflows.length,
    published: workflows.filter((wf) => wf.status === WORKFLOW_STATUS.PUBLISHED).length,
  };
  const recent = await executionRepo.recent(uid, botId, 1);
  if (recent[0]) {
    info.executions.last = {
      id: recent[0].id,
      status: recent[0].status,
      startedAt: recent[0].startedAt,
      error: recent[0].error || null,
    };
  }

  if (secret?.envelope) {
    try {
      const token = decryptSecret(secret.envelope);
      const { result, latencyMs } = await clientForToken(token, options).getWebhookInfo();
      info.webhook.telegramReported = {
        url: result?.url || '',
        pendingUpdateCount: result?.pending_update_count ?? 0,
        lastErrorDate: result?.last_error_date || null,
        lastErrorMessage: result?.last_error_message || null,
        maxConnections: result?.max_connections ?? null,
        latencyMs,
      };
    } catch (err) {
      info.webhook.telegramReported = { error: { code: err.code, message: err.message } };
    }
  }

  return info;
}
