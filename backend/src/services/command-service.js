/**
 * Command manager: CRUD, validation, Telegram synchronisation and sync-state
 * reporting. Telegram's command menu (setMyCommands) and BotForge's internal
 * command routing are separate concerns - syncing only updates the menu.
 */
import crypto from 'node:crypto';
import { commandRepo, botRepo, workflowRepo, auditRepo } from '../repositories/index.js';
import { validateCommand, fromTelegramCommands, toTelegramReplyMarkup, commandSlash } from '../../../shared/command-schema.js';
import { COMMAND_LIMITS } from '../../../shared/constants.js';
import { AppError, badRequest, notFound, conflict } from '../utils/errors.js';
import { getBotTelegramClient } from './bot-client.js';
import { telegramErrorToAppError } from './telegram-api.js';
import { nowIso } from '../utils/ids.js';

function publicCommand(cmd) {
  return {
    id: cmd.id,
    name: cmd.name,
    description: cmd.description || '',
    enabled: cmd.enabled !== false,
    reply: {
      text: cmd.reply?.text || '',
      parseMode: cmd.reply?.parseMode || 'plain',
      disablePreview: cmd.reply?.disablePreview === true,
    },
    keyboard: cmd.keyboard?.rows ? { rows: cmd.keyboard.rows } : { rows: [] },
    workflowId: cmd.workflowId || null,
    access: {
      restrictedToUserIds: cmd.access?.restrictedToUserIds || [],
      blockedUserIds: cmd.access?.blockedUserIds || [],
    },
    order: cmd.order || 0,
    createdAt: cmd.createdAt || null,
    updatedAt: cmd.updatedAt || null,
    syncedAt: cmd.syncedAt || null,
  };
}

/** Deterministic signature of what a Telegram sync would push. */
export function commandSignature(commands) {
  const payload = commands
    .filter((cmd) => cmd.enabled !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cmd) => ({ command: cmd.name, description: cmd.description || '' }));
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export async function listCommands(uid, botId) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const commands = (await commandRepo.list(uid, botId)).map(publicCommand);
  const signature = commandSignature(commands);
  const hasEnabledCommands = commands.some((cmd) => cmd.enabled);
  let state;
  if (!bot.commandsSignature) state = hasEnabledCommands ? 'pending_changes' : 'never_synced';
  else state = bot.commandsSignature === signature ? 'in_sync' : 'pending_changes';
  const sync = {
    state,
    lastSyncedAt: bot.commandsSyncedAt || null,
    currentSignature: signature,
  };
  return { commands, sync };
}

async function assertWorkflowBelongsToBot(uid, botId, workflowId) {
  if (!workflowId) return null;
  const workflow = await workflowRepo.get(uid, botId, workflowId);
  if (!workflow) throw badRequest('The selected workflow does not exist for this bot.');
  return workflow;
}

export async function saveCommand(uid, botId, input) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');

  const existing = await commandRepo.list(uid, botId);
  const duplicate = existing.find((cmd) => cmd.name === (input?.name || '').trim().replace(/^\//, '').toLowerCase() && cmd.id !== input?.id);
  const { valid, errors, command } = validateCommand(input, {
    existingNames: duplicate ? [duplicate.name] : [],
  });
  if (!valid) throw new AppError('Please fix the highlighted fields.', { status: 422, code: 'validation_failed', details: errors });

  if (command.workflowId) await assertWorkflowBelongsToBot(uid, botId, command.workflowId);

  if (input?.id) {
    const current = await commandRepo.get(uid, botId, input.id);
    if (!current) throw notFound('Command not found.');
  }

  const count = existing.filter((cmd) => cmd.id !== input?.id).length;
  if (!input?.id && count >= COMMAND_LIMITS.MAX_COMMANDS) {
    throw conflict(`A bot can hold at most ${COMMAND_LIMITS.MAX_COMMANDS} commands (Telegram limit).`);
  }

  const saved = await commandRepo.save(uid, botId, command);
  await auditRepo.record(uid, { action: 'command.saved', botId, commandId: saved.id, name: saved.name });
  return publicCommand(saved);
}

export async function deleteCommand(uid, botId, commandId) {
  const command = await commandRepo.get(uid, botId, commandId);
  if (!command) throw notFound('Command not found.');
  await commandRepo.delete(uid, botId, commandId);
  await auditRepo.record(uid, { action: 'command.deleted', botId, commandId, name: command.name });
  return true;
}

export async function replaceCommands(uid, botId, commands) {
  if (!Array.isArray(commands)) throw badRequest('commands must be an array.');
  if (commands.length > COMMAND_LIMITS.MAX_COMMANDS) {
    throw badRequest(`A bot can hold at most ${COMMAND_LIMITS.MAX_COMMANDS} commands.`);
  }
  const seen = new Set();
  const validated = [];
  const allErrors = [];
  for (const [index, input] of commands.entries()) {
    const { valid, errors, command } = validateCommand(input);
    if (seen.has(command.name)) errors.push({ field: 'name', message: `Duplicate command /${command.name}.` });
    seen.add(command.name);
    if (!valid || errors.length > 0) {
      for (const err of errors) allErrors.push({ ...err, field: `commands[${index}].${err.field}` });
      continue;
    }
    validated.push(command);
  }
  if (allErrors.length > 0) {
    throw new AppError('Some commands are invalid.', { status: 422, code: 'validation_failed', details: allErrors });
  }
  const saved = await commandRepo.replaceAll(uid, botId, validated);
  await auditRepo.record(uid, { action: 'commands.replaced', botId, count: saved.length });
  const { commands: list, sync } = await listCommands(uid, botId);
  return { commands: list, sync };
}

/**
 * Push the enabled command menu to Telegram. Requires explicit confirmation
 * because it overwrites the bot's existing command menu.
 */
export async function syncCommands(uid, botId, { confirm = false, scope = null } = {}, options = {}) {
  if (confirm !== true) {
    throw badRequest('Syncing replaces the command menu stored in Telegram. Send confirm: true to proceed.');
  }
  const { bot, client } = await getBotTelegramClient(uid, botId, options);
  const { commands } = await listCommands(uid, botId);
  const payload = commands
    .filter((cmd) => cmd.enabled)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .slice(0, COMMAND_LIMITS.MAX_COMMANDS)
    .map((cmd) => ({ command: cmd.name, description: (cmd.description || '').slice(0, COMMAND_LIMITS.DESCRIPTION_MAX) }));

  let before = [];
  try {
    const { result } = await client.getMyCommands(scope);
    before = Array.isArray(result) ? result : [];
  } catch (err) {
    // A missing menu is not fatal; an invalid token is.
    if (err.code === 'invalid_token') throw telegramErrorToAppError(err);
  }

  try {
    await client.setMyCommands(payload, scope);
  } catch (err) {
    await auditRepo.record(uid, { action: 'commands.sync_failed', botId, code: err.code });
    throw telegramErrorToAppError(err);
  }
  const signature = commandSignature(commands);
  await botRepo.update(uid, botId, {
    commandsSyncedAt: nowIso(),
    commandsSignature: signature,
    connection: { ...(bot.connection || {}), state: 'connected', lastCheckedAt: nowIso(), lastError: null },
  });
  await auditRepo.record(uid, { action: 'commands.synced', botId, count: payload.length });

  return {
    commands: payload,
    previousCommands: before,
    sync: { state: 'in_sync', lastSyncedAt: nowIso(), currentSignature: signature },
  };
}

/** Pull the current Telegram command menu into BotForge as editable stubs. */
export async function importCommands(uid, botId, options = {}) {
  const { client } = await getBotTelegramClient(uid, botId, options);
  let result;
  try {
    ({ result } = await client.getMyCommands());
  } catch (err) {
    throw telegramErrorToAppError(err);
  }
  const remote = fromTelegramCommands(result);
  const existing = await commandRepo.list(uid, botId);
  const existingNames = new Set(existing.map((cmd) => cmd.name));
  const importedNames = [];
  for (const remoteCommand of remote) {
    if (existingNames.has(remoteCommand.name)) continue;
    const { valid, command } = validateCommand({
      name: remoteCommand.name,
      description: remoteCommand.description,
      reply: { text: '', parseMode: 'plain', disablePreview: false },
      keyboard: { rows: [] },
      enabled: true,
    });
    if (!valid) continue;
    await commandRepo.save(uid, botId, command);
    existingNames.add(remoteCommand.name);
    importedNames.push(commandSlash(command.name));
  }
  await auditRepo.record(uid, { action: 'commands.imported', botId, count: importedNames.length });
  const { commands, sync } = await listCommands(uid, botId);
  return { remote, imported: importedNames, commands, sync };
}

/** Build the Telegram payload for a single command reply (used by live tests). */
export function buildCommandReply(command) {
  const replyMarkup = toTelegramReplyMarkup(command.keyboard);
  return {
    text: command.reply?.text || '',
    parseMode: command.reply?.parseMode || 'plain',
    disablePreview: command.reply?.disablePreview === true,
    replyMarkup,
  };
}
