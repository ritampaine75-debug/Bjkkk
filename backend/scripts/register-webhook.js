#!/usr/bin/env node
/**
 * Register (or refresh) the Telegram webhook for one bot from the command line.
 *
 * Usage:
 *   node backend/scripts/register-webhook.js --email you@example.com --bot <botId>
 *   node backend/scripts/register-webhook.js --uid <uid> --bot <botId> --drop-pending
 *
 * Requires TELEGRAM_WEBHOOK_BASE_URL (or APP_BASE_URL) to be set to the public
 * HTTPS URL of this deployment. The bot token is never printed.
 */
import config, { assertValidConfig } from '../src/config.js';
import { getStore } from '../src/db/index.js';
import { userRepo, botRepo } from '../src/repositories/index.js';
import { registerWebhook, publicBaseUrl } from '../src/services/webhook-service.js';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

async function resolveUid() {
  const uid = arg('uid');
  if (uid) return String(uid);
  const email = arg('email');
  if (!email) throw new Error('Provide --uid <uid> or --email <email> so the bot owner can be resolved.');
  // Local auth keeps an email -> uid credential record; Firebase users are
  // resolved through the Admin SDK in the dashboard, so --uid is required there.
  const credentials = await userRepo.findCredentialsByEmail(String(email));
  const user = credentials ? { uid: credentials.uid } : null;
  if (!user?.uid) {
    throw new Error(
      'Could not resolve that email to a user id in this database. Use --uid instead (visible in the audit log or your user document).',
    );
  }
  return user.uid;
}

async function main() {
  assertValidConfig();
  await getStore();
  if (!publicBaseUrl()) {
    throw new Error(
      'TELEGRAM_WEBHOOK_BASE_URL (or APP_BASE_URL) must be set to the public HTTPS URL of this deployment.',
    );
  }
  const botId = arg('bot');
  if (!botId || botId === true) throw new Error('Provide --bot <botId>.');

  const uid = await resolveUid();
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw new Error(`Bot ${botId} does not belong to that user.`);

  const result = await registerWebhook(uid, botId, { dropPendingUpdates: Boolean(arg('drop-pending', false)) });
  console.log(`Webhook registered for ${bot.displayName || botId}.`);
  console.log(`  URL:    ${result.webhook.url}`);
  console.log(`  Since:  ${result.webhook.registeredAt}`);
  console.log(`  Base:   ${config.telegram.webhookBaseUrl || config.appBaseUrl}`);
  console.log('The capability key in the URL is stored only as a hash; re-run this command to rotate it.');
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
