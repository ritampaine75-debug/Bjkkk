/**
 * Resolves a Telegram client for a bot the authenticated user owns.
 * Ownership is checked here so no caller can decrypt another user's token.
 */
import { botRepo, botSecretRepo } from '../repositories/index.js';
import { decryptSecret } from './token-vault.js';
import { createTelegramClient } from './telegram-api.js';
import { notFound, AppError } from '../utils/errors.js';
import { BOT_CONNECTION_STATE } from '../../../shared/constants.js';

export async function getBotTelegramClient(uid, botId, options = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  const secret = await botSecretRepo.get(botId);
  if (!secret?.envelope) {
    throw new AppError('This bot has no stored token. Connect or reconnect the bot first.', {
      status: 409,
      code: 'missing_token',
    });
  }
  if (bot.connection?.state === BOT_CONNECTION_STATE.REVOKED) {
    throw new AppError('This bot connection has been revoked. Reconnect the bot to continue.', {
      status: 409,
      code: 'connection_revoked',
    });
  }

  let token;
  try {
    token = decryptSecret(secret.envelope);
  } catch (err) {
    throw new AppError(
      'The stored token could not be decrypted. The encryption key may have changed - reconnect the bot.',
      { status: 500, code: err.code || 'vault_error' },
    );
  }
  return { bot, client: createTelegramClient({ token, ...options }) };
}
