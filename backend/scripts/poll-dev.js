#!/usr/bin/env node
/**
 * Development-only long polling.
 *
 * Telegram must never be consumed by a webhook and a poller at the same time.
 * This script refuses to start while the bot has an active webhook and offers
 * `--drop-webhook` to remove it first. It runs the same runtime path as the
 * webhook (dedupe, matching, execution records), so behaviour stays identical.
 *
 * Usage: node backend/scripts/poll-dev.js --uid <uid> --bot <botId> [--drop-webhook] [--once]
 */
import { getStore } from '../src/db/index.js';
import { assertValidConfig } from '../src/config.js';
import { botRepo } from '../src/repositories/index.js';
import { getBotTelegramClient } from '../src/services/bot-client.js';
import { processUpdate } from '../src/services/live-runtime.js';
import { removeWebhook } from '../src/services/webhook-service.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assertValidConfig();
  await getStore();

  const uid = arg('uid');
  const botId = arg('bot');
  if (!uid || uid === true || !botId || botId === true) {
    throw new Error('Usage: node backend/scripts/poll-dev.js --uid <uid> --bot <botId> [--drop-webhook] [--once]');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Polling is a development/alternative mode and refuses to run with NODE_ENV=production.');
  }

  const bot = await botRepo.get(String(uid), String(botId));
  if (!bot) throw new Error('Bot not found for that user.');
  if (bot.webhook?.state === 'active') {
    if (!arg('drop-webhook', false)) {
      throw new Error(
        'This bot has an active webhook. Telegram cannot be consumed twice - remove the webhook first or pass --drop-webhook.',
      );
    }
    await removeWebhook(String(uid), String(botId));
    console.log('Webhook removed; switching to polling.');
  }

  const { client } = await getBotTelegramClient(String(uid), String(botId));
  console.log(`Polling updates for ${bot.displayName || botId}. Press Ctrl+C to stop.`);

  let offset = 0;
  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
    console.log('\nStopping poller…');
    process.exit(0);
  });

  while (!stopped) {
    let updates = [];
    try {
      const { result } = await client.getUpdates({ offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      updates = Array.isArray(result) ? result : [];
    } catch (err) {
      console.error(`getUpdates failed (${err.code || 'error'}): ${err.message}`);
      await sleep(3000);
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, Number(update.update_id) + 1);
      try {
        const summary = await processUpdate({ uid: String(uid), botId: String(botId), update, client });
        console.log(`update ${update.update_id}:`, JSON.stringify(summary.executions || summary.skipped || summary.duplicate || 'no match'));
      } catch (err) {
        console.error(`update ${update.update_id} failed: ${err.message}`);
      }
    }
    if (arg('once', false) && updates.length === 0) break;
    await sleep(updates.length === 0 ? 500 : 50);
  }
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
